# Ringo push bildirim (Web Push) ve Telegram'ın kaldırılması

Karar tarihi: 2026-10-06. Bu dosya sözleşmedir; değişiklik Şef'e bildirilir.

## 1. Kapsam
- Telegram tamamen kalkar (kod, DB, test, rehber, ortam değişkeni).
- Yerine standart Web Push (VAPID, `web-push` paketi). Firebase yok. Android (Chrome, tarayıcı ya da ana ekran) ve iPhone (iOS 16.4+, yalnız ana ekrana eklenmiş uygulama).
- İlk sürüm bildirim türleri (yalnız bunlar gönderilir):
  1. **Geri arama vakti** (`callback`): "Sonra ara" saati gelen müşteri, atanmış çalışana.
  2. **Randevu hatırlatma** (`appointment`): "Dükkana gelecek" randevusundan `appointment_lead_minutes` (varsayılan 60) önce, atanmış çalışana.
- Sonraya bırakılanlar (Bildirimler ekranında "Yakında" olarak listelenir, gönderilmez): sabah özeti, akşam özeti, yeni devir/atama, PIN kilitlendi (güvenlik).
- Kilit ekranında müşteri adı görünür: yalnız ad + soyadın baş harfi ("Esra U."). Telefon numarası bildirime girmez.

## 2. DB sözleşmesi (yeni migration, eski migration'lara dokunulmaz)
Yeni tablo `push_subscriptions`: `id uuid pk`, `tenant_id`, `member_id` (FK `members(tenant_id,id)` on delete cascade), `endpoint text not null unique` (https, ≤2048), `p256dh text not null`, `auth text not null`, `user_agent text null` (≤300), `created_at`, `last_seen_at`. RLS açık; çalışan yalnız kendi satırlarını SELECT eder; INSERT/UPDATE/DELETE doğrudan kapalı (RPC). Üye başına en çok 10 abonelik (en eskisi silinir).

`members`: yeni `notify_callback boolean not null default true`, `notify_appointment boolean not null default true`. `notify_morning`, `notify_summary` kalır (gelecek). `notify_reminder` düşer.
`tenant_settings`: yeni `push_enabled boolean not null default true`, `appointment_lead_minutes smallint not null default 60 check in (30,60,120)`. `telegram_enabled`, `telegram_bot_username`, `reminder_hour` düşer; `telegram_enabled` kullanan her yer `push_enabled`'a taşınır.
`notification_log`: `ref_id uuid null` eklenir (müşteri kimliği); tekillik `(member_id, kind, day, coalesce(ref_id, sıfır-uuid))` olur. Kind değerleri: `callback`, `appointment`, `test`.

RPC (hepsi security definer, `search_path = public, pg_temp`, `revoke ... from public, anon`, authenticated'a grant; `current_member()` ile kilit denetimi):
- `push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null) returns void`: endpoint doğrulama (https, uzunluk, p256dh/auth base64url biçimi ve uzunluk), aynı endpoint başka üyedeyse çağırana taşınır (paylaşılan cihaz), `last_seen_at` güncellenir.
- `push_unsubscribe(p_endpoint text) returns void`: yalnız çağıranın kendi satırı.
- `push_status() returns jsonb`: `{devices, notify_callback, notify_appointment, push_enabled}`.
- `set_push_prefs(p_callback boolean, p_appointment boolean) returns void`.
- `push_team_status() returns table(member_id uuid, full_name text, devices int, notify_callback boolean, notify_appointment boolean)`: yalnız yönetici, kendi kiracısının aktif üyeleri.
- `set_push_settings(p_enabled boolean, p_lead integer) returns void`: yalnız yönetici.
İç (yalnız service role / postgres, authenticated'a kapalı):
- `_notification_targets(p_now timestamptz)` yeniden yazılır, dönüş: `(tenant_id uuid, member_id uuid, kind text, ref_id uuid, payload jsonb)`.
  - `callback`: müşterinin atanmış üyesi, son arama sonucu `callback`, `next_call_at <= p_now` ve `> p_now - interval '45 minutes'`, müşteri hâlâ açık (`pending`/`retry`), üyede `notify_callback`, kiracıda `push_enabled`, üyenin ≥1 aboneliği var. Payload: `{first_name, last_initial, at}` (`at` = `HH:MM` Istanbul). Müşteri başına bir satır.
  - `appointment`: `appointment_day = bugün (Istanbul)` ve randevu saati − lead ≤ now, randevu saati > now − 10 dk; üyede `notify_appointment`, `push_enabled`, ≥1 abonelik. Payload: `{first_name, last_initial, time}`.
  - Her satır `_notification_claim/_finish/_done` ile tek seferlik (idempotent); mevcut fonksiyonlar `ref_id` alacak biçimde genişler.
  - ÖNEMLİ: eski `_notification_targets` Telegram dışında yan etki taşıyorsa (dağıtım tetikleme) bunlar kaybolmamalı. `run_scheduled_distribution` zaten yapıyorsa tekrar etmeye gerek yok; yapmıyorsa orada yapılır.
- Telegram'a özel her şey düşer: tablolar `telegram_link_codes`, `telegram_link_attempts`; fonksiyonlar `_telegram_*`, `telegram_create_link_code`, `telegram_unlink`; kolonlar `members.telegram_chat_id`, `telegram_linked_at` (SELECT grant listesi, `anonymize_member`, dizinler yeniden yazılır).
- `set_notify_prefs` ve `unlink`/Telegram RPC'leri kalkar ya da sadeleşir; yerine `set_push_prefs`.
`pg_cron` işi `telefoncu-notify` ve `_call_notify()` AYNEN kalır (5 dakikada bir `/api/cron/notify`).

## 3. Uygulama sözleşmesi
- Paketler: `web-push`, `@types/web-push`.
- Ortam değişkenleri (Vercel Production + `.env.example` adları): `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto). Telegram değişkenleri kalkar. `CRON_SECRET`, `APP_URL` kalır.
- `public/sw.js`: yalnız `push` ve `notificationclick` (+ `pushsubscriptionchange` en iyi gayret). Önbellek/fetch yok. Payload YALNIZ `data` (JSON `{title, body, url, tag}`), ekranı SW çizer (çift bildirim olmasın). Tıklayınca açık pencereye odaklanır ya da `url`'yi açar. İkon `/icon-192.png`, rozet için `/icon-192.png`. `next.config.ts`: `/sw.js` için `Cache-Control: no-cache, no-store, must-revalidate` ve `Service-Worker-Allowed: /`. `src/proxy.ts` matcher'ı `sw.js`'i muaf tutar.
- İstemci (Profil > Bildirimler kartı): durumlar `desteklenmiyor` / `iPhone: önce ana ekrana ekle` (iOS ve standalone değilse, adım adım rehber) / `izin verilmedi` / `kapalı` / `açık`. Düğmeler (kullanıcı dokunuşuyla): "Bu cihazda bildirimleri aç" (izin iste, SW kaydet, `PushManager.subscribe` ile `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `push_subscribe` RPC), "Bu cihazda kapat", "Test bildirimi gönder". Tür anahtarları: geri arama, randevu (`set_push_prefs`). Cihaz sayısı gösterilir.
- Sunucu: `POST /api/push/test` (oturumlu üyeye test bildirimi, dakikada en çok 1, kilitli oturum reddedilir). Abonelik kaydı RPC ile doğrudan istemciden (ayrı API gerekmez).
- `src/lib/telegram/` silinir; `src/lib/push/` oluşur: `send.ts` (VAPID, TTL 3600 sn, `urgency: "high"` callback/appointment için, 404/410 → abonelik silinir, diğer hatalarda başarısız say), `messages.ts` (Türkçe metinler; em dash yok), `notify.ts` (`processNotifyRequest`: Bearer doğrulama, `_notification_targets`, claim, tüm cihazlara gönder, finish; `?dry=1` korunur). `src/lib/telegram/auth.ts`'deki `safeEqual`/`bearerToken` taşınıp korunur.
- `/api/cron/notify` kalır; `/api/telegram/*` kalkar. `src/lib/supabase/middleware.ts` ve `src/proxy.ts` içinde Telegram muafiyeti kalkar.
- Ayarlar > Bildirimler (yönetici): (1) "Hangi bildirimler gönderilir" listesi: Geri arama vakti ve Randevu hatırlatma (açık), Sabah özeti, Akşam özeti, Yeni devir/atama, PIN kilitlendi ("Yakında" etiketi); (2) mağaza anahtarı `push_enabled`; (3) randevu hatırlatma süresi (30/60/120 dk); (4) ekip tablosu: kim kaç cihazda bildirim açmış (`push_team_status`). Dağıtım saati ayarı (Kurallar'daki) bozulmaz; yalnız Telegram'a ait alanlar kalkar.
- Güvenlik: bildirimde telefon numarası yok; abonelik anahtarları (`p256dh`, `auth`) istemci rolüne SELECT edilmez (yalnız endpoint sayısı); `push_subscriptions` select politikası kolon bazlı kısıtlı ya da yalnız sayı RPC'siyle; cron route Bearer korumalı.
- Testler: pgTAP (yeni tablo/RPC/ACL/RLS, `_notification_targets` penceresi ve idempotency, kiracı yalıtımı, Telegram nesnelerinin yokluğu), vitest (mesaj metinleri, gönderici 404/410, notify akışı sahte `web-push` ile), e2e (Profil kartı durumları; gerçek push e2e'de yok), `security-probe` Telegram bölümleri push karşılıklarıyla değişir.
- Dokümanlar: `docs/kurulum.md` (Telegram bölümleri çıkar, VAPID ve push kurulumu), `docs/kilavuz/kilavuz.html`, `CLAUDE.md` (varsa).
- Kurulum betiği/VAPID: anahtar çifti `npx web-push generate-vapid-keys` ile üretilir, değerler yalnız `.env*` ve Vercel'e girer.

## 4. Dosya sahipliği
- Şerit A (DB, Opus): `supabase/migrations/20261006*_push_*.sql`, `supabase/tests/database/*`, `supabase/seed.sql`.
- Şerit B (uygulama, Sonnet): `src/**`, `public/**`, `scripts/**`, `e2e/**`, `docs/**`, `package.json`, `package-lock.json`, `.env.example`, `next.config.ts`.
- Şef: entegrasyon, `database.types.ts` son hâli, canlıya alma.
