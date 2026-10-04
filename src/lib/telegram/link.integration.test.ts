// Gerçek yerel veritabanıyla bağlama akışı. Ortam değişkenleri (Supabase URL, anon, service role)
// yoksa atlanır; vitest'i ortam dosyasıyla çalıştırınca devreye girer.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";
import { handleTelegramUpdate } from "./webhook";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ready = Boolean(url && anon && service);

const CHAT_ID = 900000123;
const CLAIM_DAY = "2000-01-01";

describe.skipIf(!ready)("Telegram bağlama (yerel DB)", () => {
  const opts = { auth: { autoRefreshToken: false, persistSession: false } };
  let admin: SupabaseClient<Database>;
  let elif: SupabaseClient<Database>;
  let can: SupabaseClient<Database>;

  beforeAll(() => {
    admin = createClient<Database>(url!, service!, opts);
    elif = createClient<Database>(url!, anon!, opts);
    can = createClient<Database>(url!, anon!, opts);
  });

  afterAll(async () => {
    await elif?.rpc("telegram_unlink", {});
    await can?.rpc("telegram_unlink", {});
    // Deneme sınırı sayacı ve sahiplenme denemesinin izleri kalmasın
    await admin?.from("telegram_link_attempts").delete().in("chat_id", [CHAT_ID, CHAT_ID + 1, CHAT_ID + 2, CHAT_ID + 3]);
    await admin?.from("notification_log").delete().eq("day", CLAIM_DAY);
  });

  it("elif kodu üretir, webhook işleyicisi chat'i bağlar", async () => {
    const login = await elif.auth.signInWithPassword({ email: "elif@demo.test", password: "Demo1234!" });
    expect(login.error).toBeNull();

    const { data: code, error } = await elif.rpc("telegram_create_link_code");
    expect(error).toBeNull();
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);

    const send = vi.fn().mockResolvedValue(undefined);
    const result = await handleTelegramUpdate(
      { message: { text: `/start ${code}`, chat: { id: CHAT_ID, type: "private" } } },
      { admin, send, appUrl: "https://app.example.com" },
    );
    expect(result).toBe("linked");
    expect(send).toHaveBeenCalledWith(CHAT_ID, expect.stringContaining("Bağlantı kuruldu"));

    // İstemci bağlı olma bilgisini telegram_linked_at ile görür; sohbet kimliği ona kapalı (D1)
    const { data: me } = await elif
      .from("members")
      .select("telegram_linked_at")
      .eq("user_id", login.data.user!.id)
      .maybeSingle();
    expect(me?.telegram_linked_at).not.toBeNull();
    const hidden = await elif.from("members").select("telegram_chat_id").eq("user_id", login.data.user!.id);
    expect(hidden.error?.code).toBe("42501");
    const { data: row } = await admin
      .from("members")
      .select("telegram_chat_id")
      .eq("user_id", login.data.user!.id)
      .single();
    expect(row?.telegram_chat_id).toBe(CHAT_ID);

    // Aynı kod ikinci kez kullanılamaz
    const again = await handleTelegramUpdate(
      { message: { text: `/start ${code}`, chat: { id: CHAT_ID + 1, type: "private" } } },
      { admin, send, appUrl: "" },
    );
    expect(again).toBe("rejected");
    expect(send).toHaveBeenLastCalledWith(CHAT_ID + 1, expect.stringContaining("kullanılmış"));
  });

  it("aynı sohbetten iki üyenin kodu eşzamanlı tüketilirse sohbet tek üyeye bağlı kalır (Ş2)", async () => {
    const elifCode = await elif.rpc("telegram_create_link_code");
    expect(elifCode.error).toBeNull();
    const login = await can.auth.signInWithPassword({ email: "can@demo.test", password: "Demo1234!" });
    expect(login.error).toBeNull();
    const canCode = await can.rpc("telegram_create_link_code");
    expect(canCode.error).toBeNull();

    const chat = CHAT_ID + 3;
    const results = await Promise.all(
      [elifCode.data!, canCode.data!].map((code) =>
        admin.rpc("_telegram_consume_link_code", { p_code: code, p_chat_id: chat }),
      ),
    );
    for (const r of results) expect(r.error).toBeNull();
    const oks = results.filter((r) => (r.data as { ok?: boolean } | null)?.ok === true).length;
    expect(oks).toBeGreaterThanOrEqual(1);

    const { count } = await admin
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("telegram_chat_id", chat);
    expect(count).toBe(1);
  });

  it("rastgele kod reddedilir", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const r = await handleTelegramUpdate(
      { message: { text: "/start ZZZZZZZZ", chat: { id: CHAT_ID, type: "private" } } },
      { admin, send },
    );
    expect(r).toBe("rejected");
  });

  it("aynı sohbetten saatte 5 başarısız denemeden sonra yanıt verilmez", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const chat = { id: CHAT_ID + 2, type: "private" };
    const results: string[] = [];
    for (let i = 0; i < 6; i++) {
      results.push(await handleTelegramUpdate({ message: { text: "/start ZZZZZZZZ", chat } }, { admin, send }));
    }
    expect(results).toEqual(["rejected", "rejected", "rejected", "rejected", "rejected", "limited"]);
    expect(send).toHaveBeenCalledTimes(5);
  });

  it("bildirim sahiplenme: ikinci sahiplenme null, başarısızdan sonra yeniden, 3 denemede biter", async () => {
    const { data: me } = await admin.from("members").select("id, tenant_id").limit(1).single();
    const args = { p_tenant: me!.tenant_id, p_member: me!.id, p_kind: "morning", p_day: CLAIM_DAY };
    const first = await admin.rpc("_notification_claim", args);
    expect(first.error).toBeNull();
    expect(typeof first.data).toBe("number");
    expect((await admin.rpc("_notification_claim", args)).data).toBeNull();
    for (let i = 0; i < 2; i++) {
      const cur = await admin.from("notification_log").select("id").eq("day", CLAIM_DAY).single();
      await admin.rpc("_notification_finish", { p_id: cur.data!.id, p_status: "failed", p_error: "ağ" });
      expect((await admin.rpc("_notification_claim", args)).data).toBe(first.data);
    }
    await admin.rpc("_notification_finish", { p_id: first.data as number, p_status: "failed", p_error: "ağ" });
    expect((await admin.rpc("_notification_claim", args)).data).toBeNull();
    const row = await admin.from("notification_log").select("status, attempts").eq("day", CLAIM_DAY).single();
    expect(row.data).toEqual({ status: "failed", attempts: 3 });
  });
});
