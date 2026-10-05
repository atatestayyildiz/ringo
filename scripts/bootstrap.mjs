#!/usr/bin/env node
// Üretim kiracısı + ilk yönetici kurulumu (tek seferlik).
// Ortam değişkenleri: SUPABASE_URL (yoksa NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY.
// Geçici şifre rastgele üretilir ve YALNIZ ekrana bir kez yazılır; hiçbir dosyaya kaydedilmez.
// Demo verisi, müşteri, PIN eklenmez: yönetici ilk girişte kendi PIN'ini belirler.
import { parseArgs } from "node:util";
import { randomInt } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const HELP = `Kullanım:
  node scripts/bootstrap.mjs --magaza "Mağaza Adı" --renk "#FF5E2B" \\
    --yonetici-eposta ornek@alan.com --yonetici-ad "Ad Soyad"

Gerekli ortam değişkenleri:
  SUPABASE_URL                 (ya da NEXT_PUBLIC_SUPABASE_URL)
  SUPABASE_SERVICE_ROLE_KEY
  BOOTSTRAP_PASSWORD           (isteğe bağlı, en az 8 karakter; yoksa rastgele geçici şifre üretilir)

Seçenekler:
  --magaza            Mağaza (marka) adı, en çok 80 karakter
  --renk              Marka rengi, #RRGGBB (varsayılan #FF5E2B)
  --yonetici-eposta   İlk yöneticinin e-postası
  --yonetici-ad       İlk yöneticinin adı soyadı
  --ek-kiraci         Başka kiracı varken yine de kur (yalnız yerel deneme;
                      giriş ekranı markası tek kiracı varsayar)
  --help              Bu yardımı göster

Davranış:
  - Veritabanında zaten bir kiracı varsa durur (ikinci kez kurmaz).
  - E-posta zaten kayıtlıysa durur.
  - Bir adım başarısız olursa oluşturulan kayıtlar geri alınır.
  - Geçici şifre yalnız ekrana bir kez yazılır; ilk girişten sonra
    Profil > Şifre bölümünden değiştirin.`;

function fail(msg, code = 1) {
  console.error(`HATA: ${msg}`);
  process.exit(code);
}

let args;
try {
  ({ values: args } = parseArgs({
    options: {
      magaza: { type: "string" },
      renk: { type: "string", default: "#FF5E2B" },
      "yonetici-eposta": { type: "string" },
      "yonetici-ad": { type: "string" },
      "ek-kiraci": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  }));
} catch (e) {
  console.error(HELP);
  fail(e instanceof Error ? e.message : String(e), 2);
}

if (args.help) {
  console.log(HELP);
  process.exit(0);
}

const magaza = (args.magaza ?? "").trim();
const renk = (args.renk ?? "").trim();
const eposta = (args["yonetici-eposta"] ?? "").trim().toLowerCase();
const ad = (args["yonetici-ad"] ?? "").trim();

if (!magaza || magaza.length > 80) fail("--magaza gerekli (1-80 karakter).", 2);
if (!/^#[0-9A-Fa-f]{6}$/.test(renk)) fail("--renk #RRGGBB biçiminde olmalı (ör. #FF5E2B).", 2);
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(eposta)) fail("--yonetici-eposta geçerli bir e-posta olmalı.", 2);
if (ad.length < 2) fail("--yonetici-ad en az 2 karakter olmalı.", 2);

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail("SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY ortam değişkenleri tanımlı olmalı.", 2);

/** Okunabilir, karışmayan karakterlerden 16 haneli geçici şifre (harf, rakam, sembol içerir). */
function tempPassword() {
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digit = "23456789";
  const sym = "!@#%*-_+=?";
  const all = lower + upper + digit + sym;
  const pick = (s) => s[randomInt(s.length)];
  const chars = [pick(lower), pick(upper), pick(digit), pick(sym)];
  while (chars.length < 16) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

async function emailExists(admin, email) {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Kullanıcılar okunamadı (${error.code ?? error.status ?? "?"}).`);
    if (data.users.some((u) => (u.email ?? "").toLowerCase() === email)) return true;
    if (data.users.length < 1000) return false;
  }
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

let tenantId = null;
let userId = null;

async function rollback() {
  if (userId) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) console.error(`Geri alma: kullanıcı silinemedi (${userId}). Supabase panelinden silin.`);
  }
  if (tenantId) {
    const { error } = await admin.from("tenants").delete().eq("id", tenantId);
    if (error) console.error(`Geri alma: kiracı silinemedi (${tenantId}). SQL Editor'dan silin.`);
  }
}

try {
  const { count, error: cErr } = await admin.from("tenants").select("id", { count: "exact", head: true });
  if (cErr) throw new Error(`Kiracılar okunamadı. Migration'lar uygulandı mı? (${cErr.code ?? cErr.message})`);
  if ((count ?? 0) > 0 && !args["ek-kiraci"]) {
    fail(`Veritabanında zaten ${count} kiracı var. Kurulum ikinci kez yapılmaz.`);
  }

  if (await emailExists(admin, eposta)) fail("Bu e-posta zaten kayıtlı. Başka bir e-posta kullanın.");

  const { data: t, error: tErr } = await admin.from("tenants").insert({ name: magaza }).select("id").single();
  if (tErr || !t) throw new Error(`Kiracı oluşturulamadı (${tErr?.code ?? "?"}).`);
  tenantId = t.id;

  // tenant_settings satırı tetikleyiciyle (tenants_default_settings) varsayılanlarla oluşur
  const { data: s, error: sErr } = await admin
    .from("tenant_settings")
    .update({ brand_name: magaza, brand_color: renk.toUpperCase() })
    .eq("tenant_id", tenantId)
    .select("tenant_id");
  if (sErr || !s || s.length !== 1) throw new Error(`Marka ayarları yazılamadı (${sErr?.code ?? "satır yok"}).`);

  const given = process.env.BOOTSTRAP_PASSWORD ?? "";
  if (given && given.length < 8) throw new Error("BOOTSTRAP_PASSWORD en az 8 karakter olmalı.");
  const password = given || tempPassword();
  const { data: u, error: uErr } = await admin.auth.admin.createUser({
    email: eposta,
    password,
    email_confirm: true,
    user_metadata: { full_name: ad },
  });
  if (uErr || !u?.user) throw new Error(`Yönetici hesabı oluşturulamadı (${uErr?.code ?? uErr?.status ?? "?"}).`);
  userId = u.user.id;

  const { error: mErr } = await admin.from("members").insert({
    tenant_id: tenantId,
    user_id: userId,
    full_name: ad,
    role: "manager",
    permissions: {},
    is_active: true,
  });
  if (mErr) throw new Error(`Yönetici üyeliği yazılamadı (${mErr.code ?? "?"}).`);

  console.log("");
  console.log("Kurulum tamam.");
  console.log(`  Mağaza     : ${magaza} (${renk.toUpperCase()})`);
  console.log(`  Kiracı no  : ${tenantId}`);
  console.log(`  Yönetici   : ${ad} <${eposta}>`);
  if (given) {
    console.log("  Şifre      : BOOTSTRAP_PASSWORD ile verildi.");
  } else {
    console.log(`  Geçici şifre (yalnız şimdi gösterilir): ${password}`);
    console.log("");
    console.log("Şifreyi şimdi not edin. İlk girişte PIN belirleyin, ardından Profil > Şifre bölümünden şifreyi değiştirin.");
  }
} catch (e) {
  await rollback();
  fail(e instanceof Error ? e.message : String(e));
}
