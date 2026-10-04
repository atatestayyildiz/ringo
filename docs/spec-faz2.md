# Telefoncu CRM, Faz 2 spec

Faz 1 (`docs/spec-faz1.md`) üstüne: Telegram bildirimleri, raporlar, dışa aktarma. Faz 1 sözleşmeleri geçerli. Kullanıcıya görünen metinde em dash (—) yok.

## 1. Veri modeli eklemeleri (yeni migration)

```
tenant_settings += (
  telegram_enabled boolean not null default false,
  telegram_bot_username text,          -- bağlantı linki için (t.me/<username>)
  reminder_hour int not null default 15 check (reminder_hour between 0 and 23)  -- tekrar-ara hatırlatması
)
-- summary_hour, distribution_hour Faz 1'de var.

members += (
  telegram_chat_id bigint,             -- bağlıysa dolu
  telegram_linked_at timestamptz,
  notify_morning boolean not null default true,
  notify_reminder boolean not null default true,
  notify_summary boolean not null default true   -- yalnız manager/view_reports için anlamlı
)

telegram_link_codes(
  code text pk,                        -- 8 karakter, büyük harf+rakam, karışmaz (0/O/1/I yok)
  tenant_id uuid not null, member_id uuid not null references members on delete cascade,
  expires_at timestamptz not null,     -- 15 dk
  used_at timestamptz
)

notification_log(
  id bigserial pk, tenant_id uuid not null, member_id uuid not null references members on delete cascade,
  kind text not null check (kind in ('morning','reminder','summary','test')),
  day date not null,
  status text not null check (status in ('sent','failed','skipped')),
  error text, created_at timestamptz default now()
)
-- kısmi unique index: (member_id, kind, day) where kind <> 'test'  (aynı gün aynı tür bir kez)
```

Bot token tek: sunucu ortam değişkeni `TELEGRAM_BOT_TOKEN` (Faz 3'te kiracı başına Vault'a taşınır). Webhook sırrı: `TELEGRAM_WEBHOOK_SECRET`. Zamanlayıcı sırrı: `CRON_SECRET`. `.env.example`'a eklenir.

## 2. Veritabanı fonksiyonları

| Fonksiyon | İş |
|---|---|
| `telegram_create_link_code() returns text` | Çağıranın kendisi için kod üretir (eski kullanılmamışları siler), 15 dk geçerli. |
| `telegram_unlink(p_member uuid default null)` | Kendi bağlantısını (null) veya manager ise başkasınınkini kaldırır. |
| `set_notify_prefs(p_morning bool, p_reminder bool, p_summary bool)` | Kendi tercihleri. |
| `report_range(p_from date, p_to date) returns jsonb` | manager veya `view_reports`. Aralık en fazla 366 gün. Döner: `{ totals:{attempts, customers_called, reached, appointments, visited, applied, approved, completed, rejected, not_interested, disqualified, pooled, unreachable, new_customers}, rates:{reach_rate, appointment_rate, visit_rate, close_rate}, by_member:[{member_id, full_name, attempts, reached, appointments, completed}], by_day:[{day, attempts, reached, appointments}], by_outcome:[{outcome, count}], by_source:[{source_detail, customers, appointments, completed}], by_operator:[{operator, customers, completed}] }`. Tanımlar: reached = outcome in (appointment, callback, not_interested, disqualified) olan denemeler; huni sayıları `pipeline_events` stage geçişlerinden (aralıktaki farklı müşteri). Oranlar 0-1, payda 0 ise 0. Gün sınırları Europe/Istanbul. |
| `log_export(p_kind text, p_rows int, p_filters jsonb)` | Dışa aktarmayı audit_log'a yazar (action='export'). manager veya `export`. |

Sunucu tarafı (service role, yalnız route handler'larda kullanılan) iç fonksiyonlar, authenticated/anon'a EXECUTE yok:
- `_telegram_consume_link_code(p_code text, p_chat_id bigint) returns jsonb` → `{ok, full_name, tenant_name}` veya `{ok:false, reason:'invalid'|'expired'|'used'}`. Aynı chat başka üyeye bağlıysa önceki bağlantı kaldırılır.
- `_notification_targets(p_now timestamptz) returns table(tenant_id, member_id, kind, chat_id, payload jsonb)`: Saatleri gelen (yerel saat = distribution_hour+0 için morning, reminder_hour için reminder, summary_hour için summary) ve o gün o tür için notification_log'da kaydı olmayan, telegram_enabled kiracılardaki, aktif, bağlı ve tercihi açık üyeler. Payload:
  - morning (ajan ve atanmış yönetici): `{first_name, total, retries, new, birthdays:[{full_name, days_left}]}` (bugünkü atamalardan; total 0 ise hedef dönmez).
  - reminder: `{first_name, retry_count}` (bugün atanmış ve hâlâ retry olanlar; 0 ise dönmez).
  - summary (manager ve view_reports): `{day, totals:{assigned, done, reached, appointments, retries}, members:[{full_name, assigned, done, appointments}]}`.
- `_notification_record(p_tenant uuid, p_member uuid, p_kind text, p_day date, p_status text, p_error text)`.

## 3. Telegram (Next.js)

- `src/lib/telegram/client.ts`: `sendMessage(chatId, text, opts)` Bot API `sendMessage` (parse_mode HTML, metin kaçışlı), 429'da `retry_after` kadar bir kez bekle, hata fırlatır.
- `src/lib/telegram/messages.ts`: saf fonksiyonlar `morningText`, `reminderText`, `summaryText`, `linkedText`, `helpText` (payload → Türkçe metin, uygulama linki `APP_URL` ortam değişkeninden). Vitest testleri.
  - morning örnek: "Günaydın Elif. Bugün 12 kişi aranacak: 3 tekrar arama, 9 yeni. Doğum günü yaklaşan: Hakan Yıldız (3 gün). Listeyi aç: <link>"
  - reminder: "Elif, 4 tekrar araman bekliyor. <link>"
  - summary: "Bugünün özeti (4 Ekim): 48 atama, 41 tamamlandı, 31 ulaşıldı, 14 randevu, 7 tekrar. Elif 12/12 (5 randevu), ..." 
- `POST /api/telegram/webhook`: `X-Telegram-Bot-Api-Secret-Token` başlığı `TELEGRAM_WEBHOOK_SECRET` ile sabit zamanlı karşılaştırılır, uymazsa 401. `/start <KOD>` → `_telegram_consume_link_code` → yanıt mesajı. `/start` kodsuz veya başka metin → `helpText`. Her zaman 200 döner (Telegram tekrar denemesin), hatalar loglanır.
- `GET|POST /api/cron/notify`: `Authorization: Bearer <CRON_SECRET>` zorunlu. `_notification_targets(now())` → her hedefe mesaj → `_notification_record`. Yanıt: `{sent, failed, skipped}`. `?dry=1` gönderim yapmadan hedefleri ve metinleri döner (test için). Vercel Cron saatlik çağırır (`vercel.json`).
- `POST /api/telegram/test`: oturumlu üye kendine test mesajı (kind='test').
- Service role istemcisi `src/lib/supabase/admin.ts` (`import 'server-only'`), yalnız bu route'larda.

## 4. Arayüz

- `/ayarlar` yeni sekme **Bildirimler** (manager): telegram_enabled anahtarı, bot kullanıcı adı, reminder_hour, mevcut distribution/summary saatlerinin özeti, ekip listesinde kimin bağlı olduğu, manager başkasının bağlantısını kaldırabilir. Token yoksa uyarı: "Bot anahtarı sunucuya eklenmedi. Kurulum adımları: ..." (BotFather adımları 4 madde).
- **Profil** sayfası `/profil` (herkes, üst çubuktaki kullanıcı hapından): Telegram'ı bağla (kod üret, `https://t.me/<bot>?start=<KOD>` düğmesi + kod metni + 15 dk geri sayım, bağlanınca durumu yenile), bağlantıyı kaldır, tercih anahtarları, "Test mesajı gönder". Şifre değiştir (Supabase `updateUser`).
- **/raporlar** (manager veya `view_reports`; menüde Yönetim'in yanında): aralık seçici (Bugün, Bu hafta, Bu ay, Geçen ay, Özel), KPI kartları (oranlarla), günlük trend (SVG hap çubuklar, prototip dili; kütüphane yok), huni (taramalı iz üstünde dolu çubuk), çalışan tablosu, sonuç dağılımı, kaynak (reklam/form) performansı, operatör dağılımı. "Raporu indir (CSV)" (`export` veya manager).
- **Dışa aktarma**: `/musteriler` üst çubuğunda "Dışa aktar" (manager veya `export`), mevcut filtrelerle `GET /api/export/customers?...` → CSV (UTF-8 BOM, `;` ayraç, Excel Türkçe uyumlu), sütunlar: Ad Soyad, Telefon, Operatör, Durum, Aşama, Atanan, Kaynak, Başvuru, Doğum Tarihi, Son Not, Oluşturma. Route oturumu ve yetkiyi sunucuda doğrular, RLS'li istemciyle çeker (yalnız görebildiği), `log_export` çağırır. `GET /api/export/report?from&to` aynı kurallarla rapor CSV'si.

## 5. Test

pgTAP: link kodu (süre, tek kullanım, başkası için üretilemez), iç fonksiyonların authenticated'a kapalı olması, `_notification_targets` saat/tercih/dedup mantığı, `report_range` sayıları seed üzerinde ve yetki, `log_export` yetkisi. Vitest: mesaj metinleri, CSV üretimi (BOM, kaçış, `;`). Route testleri: webhook yanlış sır 401, cron yetkisiz 401, `?dry=1` çıktısı.
