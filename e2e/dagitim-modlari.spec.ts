import { execSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { deleteByTag, freshPage, importCsv, loginOk, uniquePhone, uniqueTag } from "./helpers";

// Dağıtım modları: yönetici Serbest havuz seçer, satışçı "Sıradaki müşteriyi al" ile müşteri alır ve
// sınıra gelince düğme kapanır; Elle dağıtımda Bugün'de "Dağıt" yerine "Müşterileri ata" görünür.
//
// Hermetik: test yalnız kendi kurgusal müşterilerini alabilsin diye, başta kuyruğa girebilecek demo
// müşterileri (sahipsiz bekleyen ve havuzdakiler) kaydedilip kuyruk dışına (ileri tarihe) itilir; sonda
// birebir geri yüklenir. Test süresince bugünkü listeye eklenen demo satırları da silinir.
// Kiracı ayarı her testin sonunda otomatik eşit dağıtıma ve sınır 3'e döner.
test.describe.configure({ mode: "serial" });

const tag = uniqueTag();
const names = [`Sena ${tag}s`, `Selim ${tag}t`];
const FAR = "2099-01-01T00:00:00Z";

type Snap = { id: string; assigned_to: string | null; call_status: string; next_call_at: string; attempts_in_round: number };

function adminClient(): SupabaseClient {
  const out = execSync("npx supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const j = JSON.parse(out.slice(out.indexOf("{")));
  return createClient(j.API_URL as string, (j.SERVICE_ROLE_KEY ?? j.SECRET_KEY) as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());

let admin: SupabaseClient;
let tenantId = "";
let snapshot: Snap[] = [];
let rowsBefore = new Set<number | string>();

test.beforeAll(async () => {
  admin = adminClient();
  const { data: t, error: te } = await admin.from("tenants").select("id").limit(1).single();
  if (te || !t) throw new Error("kiracı okunamadı");
  tenantId = t.id;

  const { data: snap, error: se } = await admin
    .from("customers")
    .select("id, assigned_to, call_status, next_call_at, attempts_in_round")
    .eq("tenant_id", tenantId)
    .or("and(assigned_to.is.null,call_status.eq.pending),call_status.eq.pool");
  if (se) throw new Error("kuyruk anlık görüntüsü alınamadı");
  snapshot = (snap ?? []) as Snap[];

  const { data: rows, error: re } = await admin
    .from("daily_assignments")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("day", todayIst());
  if (re) throw new Error("bugünkü atamalar okunamadı");
  rowsBefore = new Set((rows ?? []).map((r) => r.id));

  // Demo kuyruğunu geçici olarak dışarıda tut (sonda geri yüklenir)
  const ids = snapshot.map((s) => s.id);
  if (ids.length) {
    const { error } = await admin.from("customers").update({ next_call_at: FAR }).in("id", ids);
    if (error) throw new Error("demo kuyruğu ayrılamadı");
  }
});

test.afterAll(async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await freshPage(browser);
  try {
    await loginOk(page, "yonetici");
    await deleteByTag(page, tag);
  } finally {
    await context.close();
  }

  // Bugünkü listeye test sırasında eklenen (test müşterisi olmayan) satırları kaldır
  const { data: rows } = await admin
    .from("daily_assignments")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("day", todayIst());
  const added = (rows ?? []).map((r) => r.id).filter((id) => !rowsBefore.has(id));
  if (added.length) await admin.from("daily_assignments").delete().in("id", added);

  // Demo müşterilerini birebir geri yükle
  for (const s of snapshot) {
    const { error } = await admin
      .from("customers")
      .update({
        assigned_to: s.assigned_to,
        call_status: s.call_status,
        next_call_at: s.next_call_at,
        attempts_in_round: s.attempts_in_round,
      })
      .eq("id", s.id);
    if (error) throw new Error(`demo müşterisi geri yüklenemedi: ${s.id}`);
  }
});

function postDone(page: Page, path: string) {
  return page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === path);
}

async function saveMode(page: Page, label: string, claimLimit?: number) {
  await page.goto("/ayarlar");
  await page.getByRole("combobox", { name: "Dağıtım yöntemi" }).click();
  await page.getByRole("listbox").getByRole("option", { name: label }).click();
  if (claimLimit !== undefined) {
    await page.getByLabel("Aynı anda en fazla açık müşteri").fill(String(claimLimit));
  }
  const done = postDone(page, "/ayarlar");
  await page.getByRole("button", { name: "Kaydet" }).click();
  expect((await done).ok()).toBe(true);
  await expect(page.getByText("Kurallar kaydedildi.")).toBeVisible();
}

async function restore(page: Page) {
  // Önce serbest havuzda sınırı 3'e çek, sonra otomatik eşit dağıtıma dön
  await saveMode(page, "Serbest havuz", 3);
  await saveMode(page, "Otomatik eşit dağıtım");
}

test("serbest havuz: satışçı sıradakini alır (yalnız test müşterisi), sınırda düğme kapanır", async ({ browser }) => {
  test.setTimeout(180_000);
  const m = await freshPage(browser);
  await loginOk(m.page, "yonetici");
  try {
    // Kuyrukta yalnız testin iki kurgusal müşterisi olsun
    const csv = ["Ad Soyad;Telefon", ...names.map((n) => `${n};${uniquePhone()}`)].join("\n");
    const res = await importCsv(m.page, Buffer.from(csv, "utf-8"));
    expect(res.inserted).toBe(2);
    // Sıra kesin olsun: ilk müşteri daha eski
    const now = Date.now();
    for (const [i, n] of names.entries()) {
      const { error } = await admin
        .from("customers")
        .update({ next_call_at: new Date(now - (2 - i) * 60_000).toISOString() })
        .eq("tenant_id", tenantId)
        .eq("full_name", n);
      expect(error).toBeNull();
    }

    await saveMode(m.page, "Serbest havuz", 3);
    await expect(m.page.getByTestId("mode-summary")).toContainText("Sıradaki müşteriyi al");

    // Yönetici Bugün'de Dağıt görmez
    await m.page.goto("/bugun");
    await expect(m.page.getByRole("button", { name: "Dağıt", exact: true })).toHaveCount(0);
    await expect(m.page.getByText(/Serbest havuz açık/)).toBeVisible();

    // Satışçının açık müşteri sayısı + 1 = sınır: bir müşteri alabilir, sonra sınırdadır
    const a = await freshPage(browser);
    try {
      await loginOk(a.page, "can");
      const card = a.page.getByTestId("claim-card");
      await expect(card).toBeVisible();
      await expect(card).toContainText("Sırada 2 müşteri bekliyor.");
      const text = await card.innerText();
      const open = Number(/(\d+) \/ \d+/.exec(text)?.[1] ?? /Listende (\d+)/.exec(text)?.[1]);
      expect(Number.isInteger(open)).toBe(true);
      test.skip(open + 1 > 50, "Satışçının açık müşterisi sınır aralığını aşıyor");

      await saveMode(m.page, "Serbest havuz", open + 1);

      await a.page.reload();
      const btn = card.getByRole("button", { name: "Sıradaki müşteriyi al" });
      await expect(btn).toBeEnabled();
      const done = postDone(a.page, "/bugun");
      await btn.click();
      expect((await done).ok()).toBe(true);
      // En eski (ilk içe aktarılan) test müşterisi verilir
      await expect(a.page.getByText(`${names[0]} listene eklendi.`)).toBeVisible();
      await expect(a.page).toHaveURL(/\/bugun\?m=/);
      await expect(card).toContainText(`Listende ${open + 1} açık müşteri var, sınır ${open + 1}.`);
      await expect(card).toContainText("Sırada 1 müşteri bekliyor.");
      await expect(btn).toBeDisabled();
      // Alınan müşteri odak kartında
      await expect(
        a.page.getByRole("group", { name: "Bugünün listesi" }).locator('[aria-current="true"]'),
      ).toHaveAccessibleName(new RegExp(names[0]));

      // Serbest havuzda Havuz yalnız görüntülenir
      await a.page.goto("/havuz");
      await expect(a.page.getByTestId("pool-mode-note")).toHaveText("Havuzdan dönen müşteriler Sıradakini al kuyruğuna girer.");
      await expect(a.page.getByRole("button", { name: /kendime al/i })).toHaveCount(0);
    } finally {
      await a.context.close();
    }
  } finally {
    await restore(m.page);
    await m.context.close();
  }
});

test("elle dağıtım: Bugün'de Dağıt yerine Müşterileri ata bağlantısı", async ({ browser }) => {
  const m = await freshPage(browser);
  await loginOk(m.page, "yonetici");
  try {
    await saveMode(m.page, "Elle dağıtım");
    await expect(m.page.getByTestId("mode-summary")).toContainText("Yönetici Müşteriler ekranından");
    await expect(m.page.getByLabel("Aynı anda en fazla açık müşteri")).toHaveCount(0);
    await m.page.goto("/bugun");
    await expect(m.page.getByRole("button", { name: "Dağıt", exact: true })).toHaveCount(0);
    const link = m.page.getByRole("link", { name: "Müşterileri ata" });
    await expect(link).toHaveAttribute("href", "/musteriler?atanan=yok");

    // Satışçıda serbest havuz kartı yok
    const a = await freshPage(browser);
    try {
      await loginOk(a.page, "can");
      await expect(a.page.getByTestId("claim-card")).toHaveCount(0);
    } finally {
      await a.context.close();
    }
  } finally {
    await restore(m.page);
    await m.context.close();
  }
});
