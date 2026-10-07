# Meta Lead Ads bağlantısı: sözleşme

Amaç: müşterinin Facebook lead formunu dolduran kişi saniyeler içinde `customers` tablosuna düşsün. Kurulum müşteri başına ayrıdır; her kurulum tek işletmedir. Meta uygulaması müşterinin kendi Business hesabındadır (Standard Access, App Review yok). Kurulum rehberi: `docs/meta-kurulum.md`.

Bu dosyadaki isimler sözleşmedir; değiştirme, Şef'e bildir.

## Ortam değişkenleri (yalnız sunucu, `.env.example`'a ADLARI eklenir)
- `META_APP_SECRET`: webhook imzası (`X-Hub-Signature-256`) doğrulaması.
- `META_VERIFY_TOKEN`: webhook GET doğrulaması.
- `META_ACCESS_TOKEN`: Sistem Kullanıcısı anahtarı (süresiz). Graph çağrıları.
- `META_PAGE_ID`: sayfa kimliği.
- `META_GRAPH_VERSION`: isteğe bağlı, varsayılan `v23.0`.
- `BUSINESS_NAME`, `BUSINESS_CONTACT`: isteğe bağlı, yalnız `/gizlilik` sayfası metni için.
- Mevcut: `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`.
Değerler loga, hata mesajına, yanıta, veritabanına yazılmaz.

## Veri akışı
1. Meta `POST /api/meta/webhook` gönderir: `{object:"page", entry:[{id, changes:[{field:"leadgen", value:{leadgen_id, page_id, form_id, created_time}}]}]}`.
2. Route ham gövdeyi okur, `X-Hub-Signature-256` (sha256 HMAC, `META_APP_SECRET`) doğrular. Hatalı/eksik imza 401, sır tanımsız 503.
3. Her `leadgen` değişikliği için: `meta_tenant_for_page(page_id)`; kiracı yoksa atla.
4. Graph: `GET /{leadgen_id}?access_token=META_ACCESS_TOKEN` döner `{id, created_time, field_data:[{name, values:[...]}], form_id}`. Alanlar: `full_name` ya da `first_name`+`last_name`; telefon `phone_number` (yoksa `phone`); Meta telefonu `p:+90...` önekiyle verebilir, `p:` önekini sil. Diğer sorular nota birleştirilir: `soru: cevap` biçiminde ` · ` ile.
5. `ingest_meta_lead(...)` çağrılır (idempotent). Sonuç `meta_record_status` ile kaydedilir.
6. Başarıda 200. Graph/DB geçici hatasında 500 (Meta yeniden dener; işlem idempotent).
7. Zamanlayıcı `GET|POST /api/cron/meta-sync` (Bearer `CRON_SECRET`): `meta_connections_list()` her kayıt için sayfadaki formları (`/{page_id}/leadgen_forms`) ve her formun son başvurularını (`/{form_id}/leads`, `last_sync_at - 30 dk` ya da ilk seferde 24 saat öncesinden) çeker, her birini `ingest_meta_lead` ile ekler (görülmüş olanlar `seen` döner). `?hours=N` (1-168) taramayı genişletir. Sonunda `meta_record_status(..., p_synced := true)`.

## Veritabanı (Şerit A)
Migration: `supabase/migrations/20261007000300_meta_leads.sql`. Her tabloda RLS açık, `tenant_id` var.

Tablolar:
- `meta_connections`: `tenant_id uuid primary key references tenants`, `page_id text not null unique`, `connected_at timestamptz default now()`, `last_lead_at timestamptz`, `last_sync_at timestamptz`, `last_error text`, `last_error_at timestamptz`. Yönetici (`role='manager'`) kendi kiracısını `select` eder; yazma yalnız fonksiyonlarla.
- `meta_leads`: `id uuid pk`, `tenant_id`, `leadgen_id text not null`, `form_id text`, `created_time timestamptz`, `result text check in ('inserted','reopened','duplicate','invalid')`, `customer_id uuid null`, `received_at timestamptz default now()`, `unique (tenant_id, leadgen_id)`. Politika yok (yalnız iç fonksiyonlar). Kişisel veri (ad, telefon) bu tabloya yazılmaz.

Fonksiyonlar (hepsi `security definer`, `set search_path = public, pg_temp`, açık `revoke execute ... from public, anon`):
- `meta_connect(p_page_id text) returns void`: yalnız yönetici (authenticated). Çağıranın kiracısı için upsert. Boş/`~ '^[0-9]{5,30}$'` dışı page_id reddedilir (Türkçe hata).
- `meta_status() returns jsonb`: yalnız yönetici. Kayıt yoksa `{"connected": false}`; varsa `{connected:true, page_id, connected_at, last_lead_at, last_sync_at, last_error, last_error_at}` (ISO zaman damgaları).
- `meta_tenant_for_page(p_page_id text) returns uuid`: yalnız `service_role`.
- `meta_connections_list() returns table(tenant_id uuid, page_id text, last_sync_at timestamptz)`: yalnız `service_role`.
- `ingest_meta_lead(p_tenant uuid, p_leadgen_id text, p_form_id text, p_created_time timestamptz, p_full_name text, p_phone text, p_note text, p_source_detail text) returns jsonb`: yalnız `service_role`. `meta_leads`'te `(tenant, leadgen_id)` varsa `{"result":"seen"}`. Yoksa satır mantığını `import_customers` ile AYNI çekirdekten geçirir (telefon normalize, geçersizse `invalid`; yeni müşteri `inserted` source `meta_api`; mevcut telefon: `import_customers`'taki yeniden açma kuralı, `applied_at = p_created_time`; aksi `duplicate`). `meta_leads`'e yazar, `meta_connections.last_lead_at` günceller, `{result, customer_id}` döner. Ortak çekirdek tek iç fonksiyona (`_` önekli, authenticated'a kapalı) çıkarılır; `import_customers` onu çağıracak biçimde yeniden yazılır ve mevcut davranış/testler (05, 30) aynen geçer.
- `meta_record_status(p_tenant uuid, p_ok boolean, p_error text default null, p_synced boolean default false) returns void`: yalnız `service_role`. `p_ok` ise `last_error` temizlenir; değilse `last_error = left(p_error, 300)`, `last_error_at = now()`. `p_synced` ise `last_sync_at = now()`.
- Zamanlayıcı: `20261005001300_notify_via_pg_net.sql` kalıbıyla `_call_meta_sync()` ve pg_cron işi `telefoncu-meta-sync` (`*/10 * * * *`), adres `/api/cron/meta-sync`. Kalıbı birebir izle (Vault `app_url`, `cron_secret`).
- `src/lib/database.types.ts` fonksiyon girdileri Şef tarafından eklendi; tablolar için Row/Insert/Update girdilerini Şerit A ekler.
- Testler: `supabase/tests/database/32_meta_leads.test.sql` (ACL anon/authenticated/ajan, yönetici dışı `meta_status`/`meta_connect` reddi, kiracı izolasyonu, idempotens `seen`, `inserted`/`duplicate`/`reopened`/`invalid`, `meta_record_status` hata/temizleme).

## Uygulama (Şerit B)
- `src/lib/meta/signature.ts`, `graph.ts`, `map.ts`, `process.ts`, `sync.ts` (+ Vitest testleri). Graph çağrıları `fetch`, zaman aşımı 10 sn, hata mesajı anahtar içermez.
- `src/app/api/meta/webhook/route.ts`: GET (hub.mode, hub.verify_token, hub.challenge; `safeEqual`), POST (yukarıdaki akış). `dynamic = "force-dynamic"`.
- `src/app/api/cron/meta-sync/route.ts`: Bearer `CRON_SECRET`.
- `src/lib/supabase/middleware.ts`: tam eşleşen `/api/meta/webhook` ve `/gizlilik` oturumsuz geçer (`/api/cron/` zaten muaf). Mevcut proxy testleri/probe çıkarımı (`scripts/security-probe.mjs`) bozulmaz; yeni yollar için probe kontrolü eklenir (imzasız POST 401, yanlış verify GET 403).
- `src/app/gizlilik/page.tsx`: herkese açık, Türkçe, sade gizlilik ve veri silme metni. Toplanan veri: formda verilen ad ve telefon (ve forma eklenen cevaplar); amaç: arama ve bilgilendirme; saklama ve silme için `BUSINESS_CONTACT`'a başvuru; üçüncü kişilerle paylaşılmaz. `BUSINESS_NAME` yoksa "bu işletme". Hukuki taahhüt metni uydurma; kısa ve genel.
- Ayarlar: `SettingsTabs`'a "Meta" sekmesi, `MetaPanel.tsx`: ortam hazır mı (dört değişkenin yalnız VAR/YOK bilgisi, değeri asla), `meta_status()` özeti (bağlı mı, son başvuru, son tarama, son hata), "Bağlantıyı kur" (sunucu action: yönetici kontrolü, sayfa token'ını al, `POST /{page_id}/subscribed_apps` `subscribed_fields=leadgen`, sonra `meta_connect`), "Şimdi tara" (son 7 gün). Hata metni Türkçe, ham Meta/DB hatası gösterilmez. UI metninde em dash yok. Mevcut Ayarlar stilini ve `Segmented`/`Card` bileşenlerini kullan.
- `.env.example`: yalnız değişken ADLARI.
- `docs/kilavuz/kilavuz.html`: Ayarlar bölümüne kısa "Meta bağlantısı" maddesi.

## Kabul testi
`npm run lint && npm run typecheck && npm test`, `npx supabase test db`; webhook GET doğrulaması, imzasız POST 401, geçerli imzalı sahte yük (Graph taklit edilerek) müşteri ekler, aynı yük ikinci kez `seen`.
