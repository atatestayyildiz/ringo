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

describe.skipIf(!ready)("Telegram bağlama (yerel DB)", () => {
  const opts = { auth: { autoRefreshToken: false, persistSession: false } };
  let admin: SupabaseClient<Database>;
  let elif: SupabaseClient<Database>;

  beforeAll(() => {
    admin = createClient<Database>(url!, service!, opts);
    elif = createClient<Database>(url!, anon!, opts);
  });

  afterAll(async () => {
    await elif?.rpc("telegram_unlink", {});
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

    const { data: me } = await elif
      .from("members")
      .select("telegram_chat_id, telegram_linked_at")
      .eq("user_id", login.data.user!.id)
      .maybeSingle();
    expect(me?.telegram_chat_id).toBe(CHAT_ID);
    expect(me?.telegram_linked_at).not.toBeNull();

    // Aynı kod ikinci kez kullanılamaz
    const again = await handleTelegramUpdate(
      { message: { text: `/start ${code}`, chat: { id: CHAT_ID + 1, type: "private" } } },
      { admin, send, appUrl: "" },
    );
    expect(again).toBe("rejected");
    expect(send).toHaveBeenLastCalledWith(CHAT_ID + 1, expect.stringContaining("kullanılmış"));
  });

  it("rastgele kod reddedilir", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const r = await handleTelegramUpdate(
      { message: { text: "/start ZZZZZZZZ", chat: { id: CHAT_ID, type: "private" } } },
      { admin, send },
    );
    expect(r).toBe("rejected");
  });
});
