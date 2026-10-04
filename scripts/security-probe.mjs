#!/usr/bin/env node
// Telefoncu CRM güvenlik denemesi (Faz 1 + Faz 2).
// Kullanım: node scripts/security-probe.mjs   (yerel Supabase ve uygulama çalışır olmalı)
// Ortam: PROBE_APP_URL (varsayılan http://localhost:3200), PROBE_PASSWORD (varsayılan demo şifresi).
// Anahtarlar `npx supabase status -o json` çıktısından alınır, hiçbir anahtar yazdırılmaz.
// Kalıcı veri bırakmaz: yalnız reddedilmesi beklenen yazmalar denenir; beklenmedik başarı (FAIL)
// olursa ilgili satır service role ile eski haline getirilir. Pozitif dışa aktarma (audit yazar) denenmez.

import { execSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = (process.env.PROBE_APP_URL ?? "http://localhost:3200").replace(/\/+$/, "");
const PASSWORD = process.env.PROBE_PASSWORD ?? "Demo1234!";
const USERS = {
  manager: "yonetici@demo.test",
  elif: "elif@demo.test", // view_reports + view_team + import_customers, export yok
  ayse: "ayse@demo.test", // yetkisiz ajan
  can: "can@demo.test", // yetkisiz ajan
};

// ---------------------------------------------------------------------------
// Ortam
// ---------------------------------------------------------------------------
function supabaseStatus() {
  let out;
  try {
    out = execSync("npx supabase status -o json", { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: true });
  } catch {
    console.error("Supabase durumu okunamadı. `npx supabase start` çalışıyor mu?");
    process.exit(2);
  }
  const j = JSON.parse(out.slice(out.indexOf("{")));
  const url = j.API_URL;
  const anon = j.ANON_KEY ?? j.PUBLISHABLE_KEY;
  const service = j.SERVICE_ROLE_KEY ?? j.SECRET_KEY;
  if (!url || !anon || !service) {
    console.error("Supabase durum çıktısında URL veya anahtar eksik.");
    process.exit(2);
  }
  return { url, anon, service };
}

const { url: SB_URL, anon: ANON, service: SERVICE } = supabaseStatus();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(SB_URL, SERVICE, opts);
const anonClient = createClient(SB_URL, ANON, opts);

// ---------------------------------------------------------------------------
// Sonuç kaydı
// ---------------------------------------------------------------------------
const results = [];
function record(group, name, ok, detail = "") {
  results.push({ group, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  [${group}] ${name}${detail ? `  (${detail})` : ""}`);
}
async function check(group, name, fn) {
  try {
    const r = await fn();
    if (r === true) record(group, name, true);
    else record(group, name, false, typeof r === "string" ? r : "beklenen sonuç alınmadı");
  } catch (e) {
    record(group, name, false, `istisna: ${e instanceof Error ? e.message : String(e)}`);
  }
}
/** PostgREST çağrısı hata ile bitmeli; codes verilirse kod da eşleşmeli. */
function expectError(res, codes) {
  if (!res.error) return `hata bekleniyordu, ${Array.isArray(res.data) ? res.data.length + " satır" : "başarılı"} döndü`;
  if (codes && !codes.includes(res.error.code)) return `kod ${res.error.code} (beklenen ${codes.join("|")})`;
  return true;
}
/** Hata yok ya da RLS ile 0 satır. */
function expectNoRows(res) {
  if (res.error) return true;
  const n = Array.isArray(res.data) ? res.data.length : res.data ? 1 : 0;
  return n === 0 ? true : `${n} satır döndü`;
}
const DENIED = ["42501"];
const FN_DENIED = ["42501", "PGRST202"];

// ---------------------------------------------------------------------------
// Oturumlar
// ---------------------------------------------------------------------------
async function signIn(email) {
  const c = createClient(SB_URL, ANON, opts);
  const { data, error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) throw new Error(`${email} giriş yapılamadı (${error?.code ?? "oturum yok"})`);
  return c;
}

/** Next.js uygulaması için @supabase/ssr biçiminde çerez başlığı üretir. */
async function appCookie(email) {
  const jar = new Map();
  const c = createServerClient(SB_URL, ANON, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`${email} uygulama oturumu kurulamadı (${error.code})`);
  // Uygulama Supabase URL'sini 127.0.0.1 veya localhost ile tanımlamış olabilir: iki çerez adı da gönderilir.
  const parts = [];
  for (const [name, value] of jar) {
    parts.push(`${name}=${value}`);
    const alt = name.replace(/^sb-127-/, "sb-localhost-");
    if (alt !== name) parts.push(`${alt}=${value}`);
  }
  return { header: parts.join("; "), client: c };
}

/** Ham HTTP isteği (yol normalleştirilmeden gönderilir). */
function rawRequest(method, rawPath, headers = {}, body) {
  const u = new URL(APP);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: u.hostname, port: u.port || 80, method, path: rawPath, headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) } },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      },
    );
    req.setTimeout(30000, () => req.destroy(new Error("zaman aşımı")));
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}
const isOkData = (r) => r.status === 200; // 2xx dışı (401/403/307/404/405/503) reddedildi sayılır

function forgedJwt() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ role: "service_role", iss: "supabase", exp: Math.floor(Date.now() / 1000) + 600 });
  const sig = createHmac("sha256", randomBytes(32)).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

// ---------------------------------------------------------------------------
// Ana akış
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Supabase: ${SB_URL}  Uygulama: ${APP}\n`);

  const { data: members, error: mErr } = await admin
    .from("members")
    .select("id, user_id, tenant_id, role, permissions, is_active, telegram_chat_id");
  if (mErr) throw new Error(`üyeler okunamadı (${mErr.code})`);
  const { data: authList } = await admin.auth.admin.listUsers({ perPage: 200 });
  const byEmail = new Map(authList.users.map((u) => [u.email, u.id]));
  const mem = (key) => members.find((m) => m.user_id === byEmail.get(USERS[key]));
  const M = { manager: mem("manager"), elif: mem("elif"), ayse: mem("ayse"), can: mem("can") };
  for (const [k, v] of Object.entries(M)) if (!v) throw new Error(`demo üyesi bulunamadı: ${k}`);
  const tenant = M.elif.tenant_id;

  // Ayşe'nin göremeyeceği (Elif'e atanmış) müşteri
  const { data: elifCust } = await admin
    .from("customers")
    .select("*")
    .eq("tenant_id", tenant)
    .eq("assigned_to", M.elif.id)
    .limit(1)
    .maybeSingle();
  if (!elifCust) throw new Error("Elif'e atanmış müşteri yok (seed?)");

  const elif = await signIn(USERS.elif);
  const ayse = await signIn(USERS.ayse);
  const can = await signIn(USERS.can);
  const manager = await signIn(USERS.manager);

  // ===== Faz 1: kiracı içi yetki ve RLS =====
  const G1 = "F1 RLS";
  await check(G1, "ajan başka ajanın müşterisini göremez", async () =>
    expectNoRows(await ayse.from("customers").select("id").eq("id", elifCust.id)),
  );
  await check(G1, "ajan başka ajanın müşterisini güncelleyemez", async () => {
    const r = await ayse.from("customers").update({ last_note: elifCust.last_note }).eq("id", elifCust.id).select("id");
    return expectNoRows(r);
  });
  await check(G1, "ajan başka ajanın müşterisini silemez", async () => {
    const r = await ayse.from("customers").delete().eq("id", elifCust.id).select("id");
    const res = expectNoRows(r);
    const { data: still } = await admin.from("customers").select("id").eq("id", elifCust.id).maybeSingle();
    if (!still) {
      await admin.from("customers").insert(elifCust); // FAIL durumunda satırı geri koy
      return "müşteri silindi (satır geri yüklendi, bağlı kayıtlar kaybolmuş olabilir)";
    }
    return res;
  });
  await check(G1, "customers doğrudan INSERT kapalı (import yetkili ajan)", async () => {
    const phone = `0555${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
    const r = await elif.from("customers").insert({ tenant_id: tenant, full_name: "Probe Kişi", phone, call_status: "retry" });
    if (!r.error) await admin.from("customers").delete().eq("tenant_id", tenant).eq("phone", phone);
    return expectError(r, DENIED);
  });
  await check(G1, "ajan kendi rolünü yükseltemez", async () => {
    const r = await elif.from("members").update({ role: "manager" }).eq("id", M.elif.id).select("id");
    const { data: now } = await admin.from("members").select("role").eq("id", M.elif.id).single();
    if (now.role !== M.elif.role) {
      await admin.from("members").update({ role: M.elif.role }).eq("id", M.elif.id);
      return "rol değişti (geri alındı)";
    }
    return expectNoRows(r);
  });
  await check(G1, "ajan kendi yetkilerini değiştiremez", async () => {
    const r = await ayse.from("members").update({ permissions: { view_all_customers: true, export: true } }).eq("id", M.ayse.id).select("id");
    const { data: now } = await admin.from("members").select("permissions").eq("id", M.ayse.id).single();
    if (JSON.stringify(now.permissions) !== JSON.stringify(M.ayse.permissions)) {
      await admin.from("members").update({ permissions: M.ayse.permissions }).eq("id", M.ayse.id);
      return "yetkiler değişti (geri alındı)";
    }
    return expectNoRows(r);
  });
  await check(G1, "members user_id/tenant_id güncellemesi kapalı (yönetici dahil)", async () =>
    expectError(await manager.from("members").update({ tenant_id: randomUUID() }).eq("id", M.ayse.id).select("id"), DENIED),
  );
  await check(G1, "ajan members INSERT yapamaz", async () =>
    expectError(await elif.from("members").insert({ tenant_id: tenant, user_id: randomUUID(), full_name: "Probe", role: "manager" }), DENIED),
  );
  await check(G1, "ajan tenants INSERT yapamaz", async () =>
    expectError(await elif.from("tenants").insert({ name: "Probe" }), DENIED),
  );
  await check(G1, "ajan tenant_settings güncelleyemez", async () => {
    const { data: s } = await admin.from("tenant_settings").select("*").eq("tenant_id", tenant).single();
    const r = await elif.from("tenant_settings").update({ telegram_enabled: s.telegram_enabled, brand_name: s.brand_name }).eq("tenant_id", tenant).select("tenant_id");
    return expectNoRows(r);
  });
  for (const [table, row] of [
    ["call_attempts", { tenant_id: tenant, customer_id: elifCust.id, member_id: M.elif.id, outcome: "busy" }],
    ["daily_assignments", { tenant_id: tenant, customer_id: elifCust.id, member_id: M.elif.id, day: "2000-01-01" }],
    ["audit_log", { tenant_id: tenant, member_id: M.elif.id, action: "probe" }],
  ]) {
    await check(G1, `ajan ${table} INSERT yapamaz`, async () => expectError(await elif.from(table).insert(row), DENIED));
  }
  await check(G1, "ajan audit_log okuyamaz", async () => expectNoRows(await elif.from("audit_log").select("id").limit(5)));

  // ===== İç fonksiyonlar (authenticated ve anon) =====
  const GI = "İç fonksiyon";
  const fakeTenant = randomUUID();
  const internalCalls = [
    ["_distribute_day_for", { p_tenant: fakeTenant, p_day: "2000-01-01" }],
    ["run_scheduled_distribution", {}],
    ["_audit", { p_tenant: fakeTenant, p_member: randomUUID(), p_action: "probe", p_entity: "probe", p_entity_id: null, p_data: {} }],
    ["_recipients", { p_tenant: fakeTenant, p_day: "2000-01-01", p_exclude: null }],
    ["_has_perm", { m: {}, p_perm: "export" }],
    ["_name_initials", { p: "Probe Kişi" }],
    ["_normalize_operator", { p: "x" }],
    ["_telegram_consume_link_code", { p_code: "AAAAAAAA", p_chat_id: 1 }],
    ["_notification_targets", { p_now: new Date().toISOString() }],
    ["_notification_record", { p_tenant: fakeTenant, p_member: randomUUID(), p_kind: "test", p_day: "2000-01-01", p_status: "sent", p_error: null }],
    ["_notification_claim", { p_tenant: fakeTenant, p_member: randomUUID(), p_kind: "test", p_day: "2000-01-01" }],
    ["_notification_finish", { p_id: 0, p_status: "sent", p_error: null }],
    ["_notification_done", { p_member: randomUUID(), p_kind: "morning", p_day: "2000-01-01" }],
    ["_telegram_link_limited", { p_chat_id: 1 }],
    ["_report_range", { p_tenant: fakeTenant, p_member: null, p_from: "2026-01-01", p_to: "2026-01-31" }],
  ];
  for (const [fn, args] of internalCalls) {
    await check(GI, `${fn}: authenticated reddedilir`, async () => expectError(await elif.rpc(fn, args), DENIED));
    await check(GI, `${fn}: anon reddedilir`, async () => expectError(await anonClient.rpc(fn, args), DENIED));
  }
  await check(GI, "sahte imzalı service_role JWT reddedilir", async () => {
    const forged = createClient(SB_URL, ANON, { ...opts, global: { headers: { Authorization: `Bearer ${forgedJwt()}` } } });
    const r = await forged.rpc("_notification_targets", { p_now: new Date().toISOString() });
    return r.error ? true : "sahte JWT kabul edildi";
  });

  // ===== anon =====
  const GA = "anon";
  await check(GA, "anon customers okuyamaz", async () => {
    const r = await anonClient.from("customers").select("id").limit(1);
    return r.error ? true : expectNoRows(r);
  });
  await check(GA, "anon members okuyamaz", async () => {
    const r = await anonClient.from("members").select("id").limit(1);
    return r.error ? true : expectNoRows(r);
  });
  await check(GA, "anon current_member çağıramaz", async () => expectError(await anonClient.rpc("current_member"), FN_DENIED));
  await check(GA, "anon login_branding yalnız marka alanlarını döner", async () => {
    const r = await anonClient.rpc("login_branding");
    if (r.error) return `hata ${r.error.code}`;
    const rows = Array.isArray(r.data) ? r.data : [r.data].filter(Boolean);
    const extra = rows.flatMap((row) => Object.keys(row)).filter((k) => !["brand_name", "brand_color", "logo_url"].includes(k));
    return extra.length === 0 ? true : `fazla alan: ${[...new Set(extra)].join(",")}`;
  });
  await check(GA, "anon kayıt olamaz (signUp kapalı)", async () => {
    const email = `probe-${randomUUID()}@probe.test`;
    const r = await anonClient.auth.signUp({ email, password: `P-${randomUUID()}` });
    if (r.data?.user?.id) {
      await admin.auth.admin.deleteUser(r.data.user.id);
      return "kayıt açık (kullanıcı silindi)";
    }
    return r.error ? true : "beklenmeyen yanıt";
  });

  // ===== Faz 2: DB =====
  const G2 = "F2 DB";
  // Rapor kapsamı (20261004001100): yetkisiz ajan reddedilmez, yalnız kendi kapsamını alır
  const RANGE = { p_from: "2026-09-01", p_to: "2026-10-04" };
  const onlySelf = (r, memberId) => {
    if (r.error) return `hata ${r.error.code}`;
    if (r.data?.scope !== "member") return `kapsam ${r.data?.scope}`;
    if (r.data?.member_id !== memberId) return "kapsam başka üyeye ait";
    const others = (r.data?.by_member ?? []).filter((x) => x.member_id !== memberId);
    return others.length === 0 ? true : `${others.length} başka çalışan satırı`;
  };
  await check(G2, "report_range: yetkisiz ajan (Ayşe) yalnız kendi kapsamı", async () =>
    onlySelf(await ayse.rpc("report_range", RANGE), M.ayse.id),
  );
  await check(G2, "report_range: yetkisiz ajan (Can) yalnız kendi kapsamı", async () =>
    onlySelf(await can.rpc("report_range", RANGE), M.can.id),
  );
  await check(G2, "report_range: ajanın deneme sayısı yalnız kendi denemeleri", async () => {
    const r = await ayse.rpc("report_range", RANGE);
    if (r.error) return `hata ${r.error.code}`;
    const { count, error } = await admin
      .from("call_attempts")
      .select("id", { count: "exact", head: true })
      .eq("member_id", M.ayse.id)
      .gte("created_at", "2026-09-01T00:00:00+03:00")
      .lt("created_at", "2026-10-05T00:00:00+03:00");
    if (error) return `sayım hatası ${error.code}`;
    return r.data.totals.attempts === count ? true : `rapor ${r.data.totals.attempts}, gerçek ${count}`;
  });
  await check(G2, "report_range_member: ajan başkasının (Elif) kapsamını alamaz 42501", async () =>
    expectError(await ayse.rpc("report_range_member", { ...RANGE, p_member: M.elif.id }), DENIED),
  );
  await check(G2, "report_range_member: ajan yöneticinin kapsamını alamaz 42501", async () =>
    expectError(await can.rpc("report_range_member", { ...RANGE, p_member: M.manager.id }), DENIED),
  );
  await check(G2, "report_range_member: ajan kendi kapsamını alır", async () =>
    onlySelf(await ayse.rpc("report_range_member", { ...RANGE, p_member: M.ayse.id }), M.ayse.id),
  );
  await check(G2, "report_range_member: bilinmeyen üye 42501 (view_reports ajan)", async () =>
    expectError(await elif.rpc("report_range_member", { ...RANGE, p_member: randomUUID() }), DENIED),
  );
  await check(G2, "report_range_member: anon reddedilir", async () =>
    expectError(await anonClient.rpc("report_range_member", { ...RANGE, p_member: M.ayse.id }), FN_DENIED),
  );
  await check(G2, "report_range: view_reports ajan (Elif) ekip kapsamı", async () => {
    const r = await elif.rpc("report_range", RANGE);
    return r.error ? `hata ${r.error.code}` : r.data?.scope === "team" ? true : `kapsam ${r.data?.scope}`;
  });
  await check(G2, "day_summary: view_team yok (Ayşe) 42501", async () => expectError(await ayse.rpc("day_summary", {}), DENIED));
  await check(G2, "daily_assignments: view_team yok (Ayşe) yalnız kendi satırları", async () => {
    const r = await ayse.from("daily_assignments").select("member_id").limit(500);
    if (r.error) return `hata ${r.error.code}`;
    const others = r.data.filter((x) => x.member_id !== M.ayse.id);
    return others.length === 0 ? true : `${others.length} başka üye satırı`;
  });
  await check(G2, "report_range: anon reddedilir", async () =>
    expectError(await anonClient.rpc("report_range", { p_from: "2026-01-01", p_to: "2026-01-31" }), FN_DENIED),
  );
  await check(G2, "report_range: view_reports ajan çalıştırabilir", async () => {
    const r = await elif.rpc("report_range", { p_from: "2026-09-01", p_to: "2026-10-04" });
    return r.error ? `hata ${r.error.code}` : r.data?.totals ? true : "totals yok";
  });
  await check(G2, "report_range: 366 günden uzun aralık 22023", async () =>
    expectError(await elif.rpc("report_range", { p_from: "2025-01-01", p_to: "2026-01-02" }), ["22023"]),
  );
  await check(G2, "report_range: ters aralık 22023", async () =>
    expectError(await elif.rpc("report_range", { p_from: "2026-02-01", p_to: "2026-01-01" }), ["22023"]),
  );
  await check(G2, "log_export: export yetkisi olmayan ajan 42501", async () =>
    expectError(await elif.rpc("log_export", { p_kind: "customers", p_rows: 0, p_filters: {} }), DENIED),
  );
  await check(G2, "log_export: anon reddedilir", async () =>
    expectError(await anonClient.rpc("log_export", { p_kind: "customers", p_rows: 0, p_filters: {} }), FN_DENIED),
  );
  await check(G2, "telegram_unlink: ajan başkasınınkini kaldıramaz", async () =>
    expectError(await ayse.rpc("telegram_unlink", { p_member: M.elif.id }), DENIED),
  );
  await check(G2, "telegram_unlink: yönetici kiracı dışı üyeye P0002", async () =>
    expectError(await manager.rpc("telegram_unlink", { p_member: randomUUID() }), ["P0002"]),
  );
  await check(G2, "telegram_create_link_code: anon reddedilir", async () =>
    expectError(await anonClient.rpc("telegram_create_link_code"), FN_DENIED),
  );
  await check(G2, "set_notify_prefs: anon reddedilir", async () =>
    expectError(await anonClient.rpc("set_notify_prefs", { p_morning: false, p_reminder: false, p_summary: false }), FN_DENIED),
  );
  await check(G2, "telegram_link_codes: ajan okuyamaz", async () => expectError(await elif.from("telegram_link_codes").select("code").limit(1), DENIED));
  await check(G2, "telegram_link_codes: ajan yazamaz", async () =>
    expectError(await elif.from("telegram_link_codes").insert({ code: "ABCDEFGH", tenant_id: tenant, member_id: M.elif.id, expires_at: new Date(Date.now() + 6e5).toISOString() }), DENIED),
  );
  await check(G2, "notification_log: ajan okuyamaz (0 satır)", async () => expectNoRows(await elif.from("notification_log").select("id").limit(5)));
  await check(G2, "notification_log: yönetici yazamaz", async () =>
    expectError(await manager.from("notification_log").insert({ tenant_id: tenant, member_id: M.manager.id, kind: "test", day: "2000-01-01", status: "sent" }), DENIED),
  );
  await check(G2, "members.telegram_chat_id: ajan kendine yazamaz", async () =>
    expectError(await ayse.from("members").update({ telegram_chat_id: 42 }).eq("id", M.ayse.id).select("id"), DENIED),
  );
  await check(G2, "members.telegram_chat_id: yönetici başkasına yazamaz", async () =>
    expectError(await manager.from("members").update({ telegram_chat_id: 42 }).eq("id", M.ayse.id).select("id"), DENIED),
  );
  await check(G2, "members.notify_*: doğrudan update kapalı", async () =>
    expectError(await ayse.from("members").update({ notify_summary: true }).eq("id", M.ayse.id).select("id"), DENIED),
  );
  await check(G2, "members insert: yönetici telegram_chat_id yazamaz (D2)", async () =>
    expectError(
      await manager.from("members").insert({ tenant_id: tenant, user_id: randomUUID(), full_name: "Probe Kişi", role: "agent", telegram_chat_id: 4242 }),
      DENIED,
    ),
  );
  await check(G2, "members insert: yönetici telegram_linked_at / notify_* yazamaz (D2)", async () =>
    expectError(
      await manager.from("members").insert({ tenant_id: tenant, user_id: randomUUID(), full_name: "Probe Kişi", role: "agent", notify_morning: false }),
      DENIED,
    ),
  );
  await check(G2, "members.telegram_chat_id: ajan kolonu okuyamaz (D1)", async () =>
    expectError(await ayse.from("members").select("id, telegram_chat_id").limit(5), DENIED),
  );
  await check(G2, "members.telegram_chat_id: yönetici kolonu okuyamaz (D1)", async () =>
    expectError(await manager.from("members").select("telegram_chat_id").limit(5), DENIED),
  );
  await check(G2, "members select *: ajan reddedilir (D1)", async () =>
    expectError(await ayse.from("members").select("*").limit(1), DENIED),
  );
  await check(G2, "members.telegram_chat_id: ajan filtrede kullanamaz (D1)", async () =>
    expectError(await ayse.from("members").select("id").not("telegram_chat_id", "is", null), DENIED),
  );
  await check(G2, "members: ajan diğer kolonları ve telegram_linked_at'i okur (D1)", async () => {
    const r = await ayse.from("members").select("id, full_name, role, is_active, absent_on, telegram_linked_at, notify_morning");
    if (r.error) return `hata ${r.error.code}`;
    return r.data.length > 0 ? true : "0 satır döndü";
  });
  await check(G2, "telegram_link_attempts: ajan okuyamaz", async () =>
    expectError(await elif.from("telegram_link_attempts").select("chat_id").limit(1), DENIED),
  );
  await check(G2, "telegram_link_attempts: yönetici yazamaz/silemez", async () => {
    const ins = expectError(await manager.from("telegram_link_attempts").insert({ chat_id: 1 }), DENIED);
    if (ins !== true) return ins;
    return expectError(await manager.from("telegram_link_attempts").delete().eq("chat_id", 1), DENIED);
  });
  await check(G2, "notification_log: yönetici sahiplenme kolonlarını güncelleyemez", async () =>
    expectError(await manager.from("notification_log").update({ attempts: 1, status: "failed" }).eq("tenant_id", tenant).select("id"), DENIED),
  );

  // ===== HTTP =====
  const GH = "HTTP";
  const appUp = await rawRequest("GET", "/giris").then((r) => r.status < 500).catch(() => false);
  if (!appUp) {
    record(GH, "uygulama erişilebilir", false, `${APP} yanıt vermiyor`);
  } else {
    const startBody = { update_id: 1, message: { message_id: 1, text: "/start ABCDEFGH", chat: { id: 1, type: "private" } } };
    await check(GH, "webhook: sır başlığı yok 401", async () => {
      const r = await rawRequest("POST", "/api/telegram/webhook", {}, startBody);
      return r.status === 401 ? true : `durum ${r.status}`;
    });
    await check(GH, "webhook: yanlış sır 401", async () => {
      const r = await rawRequest("POST", "/api/telegram/webhook", { "x-telegram-bot-api-secret-token": randomUUID() }, startBody);
      return r.status === 401 ? true : `durum ${r.status}`;
    });
    await check(GH, "webhook: boş sır başlığı 401", async () => {
      const r = await rawRequest("POST", "/api/telegram/webhook", { "x-telegram-bot-api-secret-token": "" }, startBody);
      return r.status === 401 ? true : `durum ${r.status}`;
    });
    await check(GH, "cron: Authorization yok 401", async () => {
      const r = await rawRequest("GET", "/api/cron/notify?dry=1");
      return r.status === 401 ? true : `durum ${r.status}`;
    });
    await check(GH, "cron: yanlış Bearer 401 (GET)", async () => {
      const r = await rawRequest("GET", "/api/cron/notify?dry=1", { authorization: `Bearer ${randomUUID()}` });
      return r.status === 401 ? true : `durum ${r.status}`;
    });
    await check(GH, "cron: yanlış Bearer 401 (POST)", async () => {
      const r = await rawRequest("POST", "/api/cron/notify", { authorization: `Bearer ${randomUUID()}` });
      return r.status === 401 ? true : `durum ${r.status}`;
    });
    await check(GH, "cron: boş Bearer 401", async () => {
      const r = await rawRequest("GET", "/api/cron/notify?dry=1", { authorization: "Bearer " });
      return r.status === 401 ? true : `durum ${r.status}`;
    });
    await check(GH, "cron: Basic şeması 401", async () => {
      const r = await rawRequest("GET", "/api/cron/notify?dry=1", { authorization: `Basic ${Buffer.from("a:b").toString("base64")}` });
      return r.status === 401 ? true : `durum ${r.status}`;
    });
    for (const p of [
      "/api/cron/../export/customers",
      "/api/cron/..%2fexport/customers",
      "/api/cron/%2e%2e/export/customers",
      "/api/telegram/webhook/../test",
      "/api/telegram/webhook/..%2ftest",
      "/api/cron-x",
      "/api/cronx/notify",
      "/api/telegram/webhook/",
      "/api/telegram/webhook%2f..%2f..%2fexport%2fcustomers",
    ]) {
      await check(GH, `proxy muafiyeti kaçamağı yok: ${p}`, async () => {
        const r = await rawRequest("GET", p);
        if (isOkData(r)) return `200 döndü (${String(r.headers["content-type"] ?? "")})`;
        return true;
      });
    }
    await check(GH, "export/customers: oturumsuz veri yok", async () => {
      const r = await rawRequest("GET", "/api/export/customers");
      return isOkData(r) ? "200 döndü" : true;
    });
    await check(GH, "export/report: oturumsuz veri yok", async () => {
      const r = await rawRequest("GET", "/api/export/report?from=2026-10-01&to=2026-10-04");
      return isOkData(r) ? "200 döndü" : true;
    });
    await check(GH, "telegram/test: oturumsuz reddedilir", async () => {
      const r = await rawRequest("POST", "/api/telegram/test");
      return isOkData(r) ? "200 döndü" : true;
    });

    let ayseCookie, elifCookie;
    try {
      ayseCookie = await appCookie(USERS.ayse);
      elifCookie = await appCookie(USERS.elif);
    } catch (e) {
      record(GH, "uygulama oturumu kurulabilir", false, e instanceof Error ? e.message : String(e));
    }
    if (ayseCookie && elifCookie) {
      const sessionOk = await rawRequest("GET", "/bugun", { cookie: ayseCookie.header }).then((r) => r.status === 200);
      record(GH, "uygulama oturumu çerezle kurulabilir (/bugun 200)", sessionOk, sessionOk ? "" : "çerez kabul edilmedi, oturumlu denemeler anlamsız");
      if (sessionOk) {
        await check(GH, "export/customers: export yetkisiz ajan 403", async () => {
          const r = await rawRequest("GET", "/api/export/customers", { cookie: ayseCookie.header });
          return r.status === 403 ? true : `durum ${r.status}`;
        });
        await check(GH, "export/customers: view_reports var, export yok (Elif) 403", async () => {
          const r = await rawRequest("GET", "/api/export/customers", { cookie: elifCookie.header });
          return r.status === 403 ? true : `durum ${r.status}`;
        });
        await check(GH, "export/report: export yetkisiz (Elif) 403", async () => {
          const r = await rawRequest("GET", "/api/export/report?from=2026-10-01&to=2026-10-04", { cookie: elifCookie.header });
          return r.status === 403 ? true : `durum ${r.status}`;
        });
        await check(GH, "export/report: yetkisiz ajan (Ayşe) 403", async () => {
          const r = await rawRequest("GET", "/api/export/report?from=2026-10-01&to=2026-10-04", { cookie: ayseCookie.header });
          return r.status === 403 ? true : `durum ${r.status}`;
        });
        await check(GH, "telegram/test: bağlı olmayan üye için gönderim yok", async () => {
          const { data } = await admin.from("members").select("telegram_chat_id").eq("id", M.ayse.id).single();
          if (data.telegram_chat_id !== null) return true; // bağlıysa bu kontrol uygulanmaz
          const r = await rawRequest("POST", "/api/telegram/test", { cookie: ayseCookie.header });
          return r.status !== 200 ? true : "200 döndü";
        });
        await check(GH, "/raporlar: yetkisiz ajan ekip tablosunu ve başka çalışanı göremez", async () => {
          const r = await rawRequest("GET", "/raporlar", { cookie: ayseCookie.header });
          if (r.status === 200 && /Çalışanlar/.test(r.body)) return "ekip tablosu döndü";
          if (r.status === 200 && /Elif Demo|Can Demo/.test(r.body)) return "başka çalışanın adı döndü";
          if (r.status === 200 && /Raporu indir/.test(r.body)) return "CSV düğmesi döndü";
          return true;
        });
        await check(GH, "/raporlar: yetkisiz ajan sayfayı kendi kapsamıyla açar (200)", async () => {
          const r = await rawRequest("GET", "/raporlar", { cookie: ayseCookie.header });
          if (r.status !== 200) return `durum ${r.status}`;
          return /Yalnız sizin sonuçlarınız|Bu aralıkta kayıt yok/.test(r.body) ? true : "kendi kapsamı işareti yok";
        });
        await check(GH, "/yonetim: view_team (Elif) sayfayı açar (200)", async () => {
          const r = await rawRequest("GET", "/yonetim", { cookie: elifCookie.header });
          return r.status === 200 && /Son işlemler/.test(r.body) ? true : `durum ${r.status}`;
        });
        await check(GH, "/yonetim: view_team yok (Ayşe) sayfa açılmaz", async () => {
          const r = await rawRequest("GET", "/yonetim", { cookie: ayseCookie.header });
          return r.status !== 200 || !/Son işlemler/.test(r.body) ? true : "Yönetim içeriği döndü";
        });
        await check(GH, "/yonetim: yalnız view_reports (view_team yok) sayfa açılmaz", async () => {
          const before = M.elif.permissions;
          const { view_team: _vt, ...rest } = before ?? {};
          void _vt;
          await admin.from("members").update({ permissions: rest }).eq("id", M.elif.id);
          try {
            const r = await rawRequest("GET", "/yonetim", { cookie: elifCookie.header });
            return r.status !== 200 || !/Son işlemler/.test(r.body) ? true : "Yönetim içeriği döndü";
          } finally {
            await admin.from("members").update({ permissions: before }).eq("id", M.elif.id);
          }
        });
      }
      await ayseCookie.client.auth.signOut().catch(() => {});
      await elifCookie.client.auth.signOut().catch(() => {});
    }
  }

  for (const c of [elif, ayse, can, manager]) await c.auth.signOut().catch(() => {});
}

// ---------------------------------------------------------------------------
// Logo depolama ve şifre sıfırlama (marka/sıfırlama şeridi)
// ---------------------------------------------------------------------------
async function logoAndResetProbe() {
  const G = "Logo ve şifre sıfırlama";
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const { data: mgrRow } = await admin.from("members").select("tenant_id, user_id").eq("role", "manager").limit(50);
  const authList = await admin.auth.admin.listUsers({ perPage: 200 });
  const mgrId = authList.data.users.find((u) => u.email === USERS.manager)?.id;
  const tenantId = mgrRow?.find((m) => m.user_id === mgrId)?.tenant_id;
  if (!tenantId) {
    record(G, "yönetici kiracısı bulunabilir", false, "üye yok");
    return;
  }
  const otherTenant = randomUUID();
  const bucket = (c) => c.storage.from("brand-logos");
  const mine = `${tenantId}/probe-${randomUUID()}.png`;
  const created = [];
  const mgr = await signIn(USERS.manager);
  const elifC = await signIn(USERS.elif);

  const uploadFails = async (client, path, body, type) => {
    const r = await bucket(client).upload(path, body, { contentType: type, upsert: false });
    if (!r.error) {
      created.push(path);
      return "yükleme kabul edildi";
    }
    return true;
  };

  await check(G, "anon logo yükleyemez", () => uploadFails(anonClient, mine, PNG, "image/png"));
  await check(G, "çalışan (ajan) kendi kiracısına logo yükleyemez", () => uploadFails(elifC, mine, PNG, "image/png"));
  await check(G, "yönetici başka kiracı yoluna yükleyemez", () => uploadFails(mgr, `${otherTenant}/probe.png`, PNG, "image/png"));
  await check(G, "yönetici kök yola yükleyemez", () => uploadFails(mgr, `probe-${randomUUID()}.png`, PNG, "image/png"));
  await check(G, "SVG yüklenemez (bucket tür sınırı)", () =>
    uploadFails(mgr, `${tenantId}/probe-${randomUUID()}.svg`, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "image/svg+xml"),
  );
  await check(G, "512 KB üstü dosya yüklenemez (bucket boyut sınırı)", () => {
    const big = Buffer.alloc(600 * 1024);
    PNG.copy(big);
    return uploadFails(mgr, `${tenantId}/probe-${randomUUID()}.png`, big, "image/png");
  });
  await check(G, "anon logo listeleyemez", async () => {
    const r = await bucket(anonClient).list(tenantId);
    return r.error || (r.data ?? []).length === 0 ? true : `${r.data.length} dosya listelendi`;
  });

  await check(G, "yönetici kendi önekine yükler; kamu URL anon okunur; silinince erişilemez", async () => {
    const up = await bucket(mgr).upload(mine, PNG, { contentType: "image/png", upsert: false });
    if (up.error) return `yönetici yükleyemedi (${up.error.message})`;
    created.push(mine);
    const url = bucket(anonClient).getPublicUrl(mine).data.publicUrl;
    const r1 = await fetch(url);
    if (r1.status !== 200 || !(r1.headers.get("content-type") ?? "").startsWith("image/png")) return `kamu URL ${r1.status}`;
    const del = await bucket(mgr).remove([mine]);
    if (del.error) return "yönetici silemedi";
    created.splice(created.indexOf(mine), 1);
    const r2 = await fetch(url);
    return r2.status === 200 ? "silinen dosya hâlâ okunuyor" : true;
  });

  await check(G, "çalışan yöneticinin dosyasını silemez", async () => {
    const p = `${tenantId}/probe-${randomUUID()}.png`;
    const up = await bucket(mgr).upload(p, PNG, { contentType: "image/png" });
    if (up.error) return "hazırlık yüklemesi başarısız";
    created.push(p);
    await bucket(elifC).remove([p]);
    const url = bucket(anonClient).getPublicUrl(p).data.publicUrl;
    const alive = (await fetch(url)).status === 200;
    await bucket(mgr).remove([p]);
    created.splice(created.indexOf(p), 1);
    return alive ? true : "çalışan silebildi";
  });

  // Şifre sıfırlama yolları: tam eşleşme oturumsuz 200; varyantlar giriş sayfasına yönlenir.
  for (const path of ["/sifre-sifirla", "/sifre-sifirla/yeni"]) {
    await check(G, `${path} oturumsuz 200`, async () => {
      const r = await rawRequest("GET", path);
      return r.status === 200 ? true : `durum ${r.status}`;
    });
  }
  for (const path of ["/sifre-sifirla-x", "/sifre-sifirlax", "/sifre-sifirla/yeni/x", "/sifre-sifirla/x", "/sifre-sifirla%2Fyeni", "/sifre-sifirla/yeni/..%2Fbugun", "/SIFRE-SIFIRLA", "/sifre-sifirla//yeni"]) {
    await check(G, `${path} oturumsuz 307`, async () => {
      const r = await rawRequest("GET", path);
      // Çift eğik çizgi Next tarafından normalleştirilir (308 -> tam yol); korumalı içerik dönmez.
      if (path === "/sifre-sifirla//yeni") return r.status === 307 || r.status === 308 ? true : `durum ${r.status}`;
      return r.status === 307 ? true : `durum ${r.status}`;
    });
  }
  await check(G, "Auth: kayıtsız e-posta için sıfırlama isteği hata sızdırmaz", async () => {
    const r = await anonClient.auth.resetPasswordForEmail(`yok-${randomUUID().slice(0, 8)}@demo.test`);
    return r.error ? `hata: ${r.error.code}` : true;
  });

  // Beklenmedik başarıyla oluşan dosyaları temizle
  if (created.length) await admin.storage.from("brand-logos").remove(created);
  await mgr.auth.signOut().catch(() => {});
  await elifC.auth.signOut().catch(() => {});
}

main()
  .then(() => logoAndResetProbe())
  .catch((e) => {
    record("kurulum", "probe çalıştı", false, e instanceof Error ? e.message : String(e));
  })
  .finally(() => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\nÖzet: ${results.length} kontrol, ${results.length - failed.length} PASS, ${failed.length} FAIL`);
    for (const f of failed) console.log(`  FAIL [${f.group}] ${f.name}: ${f.detail}`);
    process.exit(failed.length ? 1 : 0);
  });
