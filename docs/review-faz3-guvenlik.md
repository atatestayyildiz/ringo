# Faz 3 bağımsız güvenlik incelemesi (panel kilidi, 2026-10-05 RPC'leri, canlıya çıkış)

Tarih: 2026-10-05. İnceleyen kodu yazanlardan değil; kod, migration ve test değiştirilmedi.
Kapsam: `454d359..HEAD` (panel kilidi, sahne, pg_net zamanlayıcı, bootstrap) ve çalışma ağacındaki commit edilmemiş `20261005001400_bulk_delete.sql` / `deleteCustomersAction` (kardeş şerit).

Yöntem:
- Yerel DB'de `docker exec supabase_db_Telefoncu psql -U postgres` ile `begin … rollback` içinde `set local role authenticated` + `request.jwt.claims` rol taklidi.
- Geçici hesaplarla (service role ile açılıp aynı betikte silindi: `review-lock-*`, `review-race-*`, `review-rest-*@demo.test`) PostgREST/GoTrue üzerinden canlı denemeler.
- Dev sunucu (`localhost:3200`) üzerinden server action'ları doğrudan HTTP ile çağırma (Next-Action başlığı, `.next/dev/server/server-reference-manifest.json` kimlikleri).
- `node scripts/security-probe.mjs`: **183 kontrol, 183 PASS**.

Bırakılan durum: `auth.users` içinde `review-%` 0, `members` içinde `Inceleme%` 0, `locked_at` dolu ya da `pin_failed > 0` üye 0. Yönetici demo hesabı denemede kilitlendi, psql ile `locked_at = null, pin_failed = 0` yapıldı. `tenant_settings.brand_name` yalnız aynı değerle yazıldı (veri değişmedi).
Not: `npm view threejs-components@0.0.19 dist.integrity` ile npm kayıt defterine bir salt okunur sorgu yapıldı (lockfile bütünlüğünü karşılaştırmak için).

## Özet

| Seviye | Sayı |
|---|---|
| KRİTİK | 0 |
| YÜKSEK | 2 |
| ORTA | 2 |
| DÜŞÜK | 7 |

Kiracılar arası erişim, kilitliyken müşteri verisi okuma (customers, daily_assignments, call_attempts, pipeline_events ve tüm iş RPC'leri) ve PIN sayacını yarışla aşma bulunamadı. Asıl sorun şu: kilit "müşteri verisini okuma" katmanında sağlam, ama kilitli cihazdaki oturum jetonu iki yolla tam yetkiye dönüşebiliyor (Y1, Y2). `@supabase/ssr` çerezleri `httpOnly: false` (`node_modules/@supabase/ssr/dist/main/utils/constants.js:7`). Bu yüzden masaüstünde geliştirici araçlarını açabilen biri, kilitli ekrandayken jetonu `document.cookie`'den alabilir.

---

## Canlıya çıkmadan önce mutlaka düzeltilmeli

1. **Y1.** Kilitli oturum GoTrue'da şifreyi değiştirip yeni girişle kilidi kaldırabiliyor. Çözüm: e-posta + şifre girişi kilidi kendiliğinden kaldırmasın (ya da kilitliyken değişen şifreyle kaldıramasın).
2. **Y2.** Kilitli yönetici oturumu REST üzerinden üye yetkilerini, rolleri, ekibi ve mağaza ayarlarını değiştirebiliyor. Çözüm: `auth_is_manager()` ve `auth_has_perm()` içine kilit koşulunu ekleyin; tek migration yeter.

İkisi de birer migration ile düzeltilir. pgTAP'ta (`26_panel_lock`) ve `security-probe` `kilit` grubunda bu senaryolar için test yok; düzeltmeyle birlikte eklenmeli.

---

## YÜKSEK

### Y1. Kilit, oturum jetonuyla şifre değiştirilerek tamamen aşılıyor
- Yer: `supabase/migrations/20261005001200_panel_lock.sql:295-328` (`clear_my_lock`), `src/app/giris/actions.ts:30`. GoTrue `PUT /auth/v1/user` mevcut şifreyi istemiyor. Yerelde `supabase/config.toml:230 secure_password_change = false`. Canlıda açık olsa bile GoTrue yalnız 24 saatten eski oturumda yeniden doğrulama ister; mağazada sabah açılan oturum bu sınırın içinde kalır.
- Senaryo: Kilitli cihazdaki erişim jetonu ile `updateUser({ password })` çağrılır (mevcut şifre ve PIN gerekmez). Ardından yeni şifreyle giriş yapılır. Bu taze oturum `locked_at`'tan sonra açıldığı için `clear_my_lock` kilidi kaldırır ve tüm cihazlarda panel açılır.
- Kanıt (`scratchpad/pwbypass.mjs`, geçici yönetici hesabı):
  ```
  lock_me: ok
  locked customers: 0
  updateUser without current pw: OK
  signin new pw: OK
  clear_my_lock: ok
  lock_status: {"locked":false,"has_pin":true,"auto_lock_minutes":10}
  customers now: 3
  victim old session customers: 3
  ```
- Etki: PIN hiç bilinmeden panelin tamamı açılır. Gerçek sahibin şifresi de değişmiş olur. Uygulamanın Profil'deki "mevcut şifre" kontrolü (Faz 2 O2) doğrudan GoTrue çağrısıyla atlanır.
- Öneri (en sağlamı, küçük): Şifreli giriş kilidi kaldırmasın.
  - `clear_my_lock` yalnız `pin_failed`'ı sıfırlasın; `locked_at` dolu kalsın. Ya da tamamen kaldırılsın.
  - "PIN'imi unuttum" yöneticinin yapacağı bir işe dönüşsün: yeni `reset_member_pin(p_member uuid)` RPC'si (yalnız manager, aynı kiracı, `pin_hash = null, locked_at = null, pin_failed = 0`, audit satırı). PIN'i silinen kullanıcı yeniden `/pin-belirle`'ye düşer.
  - Yöneticinin kendi PIN'i için ikinci yönetici ya da SQL Editor yolu `docs/kurulum.md`'ye yazılsın.
  - Bu yolda yeni girişte PIN sayacı da sıfırlanmamalı. Yoksa şifreyi bilen kişi her girişte 5 yeni deneme kazanır. Sayaç kalıcı olsun, 5'te yönetici sıfırlasın.
  - Alternatif (tasarım korunacaksa): `auth.users` üzerinde `encrypted_password` değişimini `members.password_changed_at`'a yazan bir tetikleyici ekleyin. `clear_my_lock`, `password_changed_at > locked_at` ise reddetsin. Bu durumda şifre sıfırlama e-postası da kilidi kaldıramaz; aynı yönetici yolu gerekir.

### Y2. Kilitli yönetici oturumu yetki, rol, ekip ve ayar yazabiliyor (yetki yükseltme zinciri)
- Yer: `auth_is_manager()` ve `auth_has_perm()` (`20261004000200_helpers.sql:106,116`) kilide bakmıyor. Kilit koşulu yalnız 4 select politikasına eklendi (`panel_lock.sql:79-118`). Etkilenen politikalar:
  - `members_insert`, `members_update`, `members_delete`
  - `tenant_settings_insert`, `tenant_settings_update`
  - `tenants_update`
  - `storage.objects brand_logos_*`
  - `audit_log_select`, `notification_log_select`
- Senaryo: Mağaza bilgisayarında yöneticinin paneli kilitli. Bir çalışan çerezden jetonu alır ve `PATCH /rest/v1/members?id=eq.<kendi id> {permissions:{view_all_customers:true, export_customers:true}}` gönderir. Sonra kendi telefonundan tüm müşterileri görür ve dışa aktarır. Aynı yolla kendine `role = manager` verebilir, çalışan silebilir, dağıtım modunu ya da markayı değiştirebilir.
- Kanıt 1 (rol taklidi, rollback):
  ```
  -- yönetici kilitli; set local role authenticated; jwt sub = yönetici
  select count(*) from customers;              -> 0   (okuma doğru engelli)
  update members set permissions = ... where full_name='Can Demo'  -> UPDATE 1 {"export_customers": true, "view_all_customers": true}
  update members set role='manager' where full_name='Ayşe Demo'    -> UPDATE 1
  delete from members where full_name='Test Çalışan'               -> DELETE 1
  update tenant_settings set brand_name='HACKED'                    -> HACKED
  update customers set last_note='HACK' where id is not null        -> UPDATE 0 (select politikası devreye girer)
  ```
- Kanıt 2 (gerçek REST, geçici yönetici, `scratchpad/restlock.mjs`):
  ```
  locked: {"locked":true,...}
  REST PATCH members while locked: [{"full_name":"Inceleme Rest","permissions":{"export_customers":true,"view_all_customers":true}}]
  REST PATCH tenant_settings while locked: [{"brand_name":"Birey İletişim"}]
  REST PATCH customers while locked: 0
  ```
  `customers` güvende. PostgREST bağlantısında `safeupdate` yüklü (filtresiz PATCH reddedilir), filtre de select politikasını tetikler.
- Öneri: Tek migration ile `auth_is_manager()` ve `auth_has_perm()` gövdesine `and m.locked_at is null` ekleyin. Bu değişiklik tüm yönetici yazma ve okuma politikalarını, depo politikalarını ve `customers_select`'in yönetici dalını birlikte kapatır.
  - `/kilit` ve `/pin-belirle` sayfaları yalnız `members_select` ve `tenant_settings_select` kullanıyor; ikisi yalnız kiracıya bakar, etkilenmez.
  - pgTAP'a "kilitli yönetici members/tenant_settings yazamaz", probe'a REST PATCH denemesi eklensin.

---

## ORTA

### O1. Kilit hesap düzeyinde: bir cihazda açmak ya da yeni giriş tüm cihazların kilidini kaldırır
- Yer: `members.locked_at` tek satır (`panel_lock.sql:10-13`), `unlock_with_pin` ve `clear_my_lock` bunu temizler.
- Senaryo: Yönetici mağaza bilgisayarını kilitleyip gider, sonra telefonundan girer (şifre ya da PIN). Bilgisayardaki kilitli sekme, sayfa yenilenince ya da görünür olunca panele döner. Masa başındaki kişi PIN bilmeden paneli kullanır. Ters yönde de geçerli: telefonda kilitlemek bilgisayarı da kilitler. Y1 kanıtındaki `victim old session customers: 3` satırı bunu da gösterir.
- Öneri: Kilidi oturuma bağlayın. Yeni `session_locks(session_id uuid primary key, member_id, locked_at)` tablosu kullanılsın; `auth_unlocked()` hem `auth.jwt()->>'session_id'` hem de üye düzeyine baksın. Kısa vadede bu davranışı kullanıcılara ve `docs/kurulum.md`'ye yazın ("bir cihazda açmak hepsini açar").

### O2. Otomatik kilit yalnız istemcide; panel verisi kilitlenmeden önce sunucuda çizilir
- Yer: `src/components/lock/AutoLock.tsx` (tek karar noktası `check()`); sunucuda boşta kalma kontrolü yok.
- Senaryo: Tarayıcı kapatılıp saatler sonra açılır. Proxy oturumu kilitsiz gördüğü için `/bugun` müşteri verisiyle birlikte sunucuda çizilir. Kilit ancak istemci `lock_status` çağrısından sonra devreye girer; arada veri ekranda ve HTML'de durur. JS kapalı istemci ya da doğrudan REST çağrısı hiç kilitlenmez.
- Öneri:
  - `members.last_active_at` (ya da oturum başına) tutun; proxy, `auto_lock_minutes` aşılmışsa `lock_me` çağırıp `/kilit`'e yönlendirsin.
  - Daha basit yol: `lock_status` RPC'si son etkinliği güncellesin ve süre dolmuşsa kendisi kilitlesin. Proxy her istekte bu RPC'yi zaten çağırıyor.

---

## DÜŞÜK

### D1. Server action'lar kilidi kendileri denetlemiyor (yalnız proxy'ye güveniyor)
- Yer: `src/lib/session.ts:23-55` (`getSessionContext` kilit durumuna bakmıyor). `createMemberAction` (`src/app/(app)/ayarlar/actions.ts:101-140`) service role ile kullanıcı açıyor.
- Kanıt: Kilitliyken `POST /ayarlar` (createMemberAction) -> `307 /kilit`. `POST /kilit` aynı action kimliğiyle -> `200 "{}"`. Action çalışmadı, çünkü action /kilit sayfasının çalışanında yok. Dev sunucuda doğrulandı; production derlemede (`next start`) davranış ayrıca doğrulanmadı.
- Öneri: Savunma derinliği için `getSessionContext` içinde `lock_status` kontrolü yapın (kilitliyse `redirect("/kilit")`). Ya da service role kullanan action'lara açık bir `requireUnlocked()` ekleyin.

### D2. Kilitliyken ekip listesi, mağaza ayarları ve (yönetici için) audit/bildirim günlüğü okunabiliyor
- Kanıt: Kilitli yönetici REST ile `members` 5 satır (ad, rol, yetkiler), `tenant_settings`, `audit_log` 1769 satır okudu. Audit verisi büyük ölçüde PII'siz: ad baş harfleri, telefonun son 4 hanesi. Ancak `export` kayıtlarının `filters` alanında arama terimi olabilir.
- Öneri: Y2 düzeltmesi audit ve bildirim günlüğünü kapatır. `members` ve `tenant_settings` kilit ekranı için gerekli; kabul edilebilir.

### D3. `take_from_pool` kişi başı sınır koymuyor; havuzdaki tüm telefonlar toplanabilir
- Yer: `20261005001100_morning_modes.sql:145` (`take_from_pool`), dönüş tipi tam `customers` satırı (telefon ve doğum tarihi dahil).
- Senaryo: `auto_even` ya da `manual` modunda herhangi bir çalışan `list_pool` ile id'leri alır ve döngüyle `take_from_pool` çağırarak havuzun tamamını kendine çeker. Her dönüşte telefon gelir. `claim_next`'teki `claim_limit` burada yok. Audit satırı yazılıyor.
- Öneri: `take_from_pool`'a da `_open_claim_count(...) >= claim_limit` kontrolü ekleyin. Ya da dönüşü telefon olmadan verin; telefon zaten Bugün listesinde RLS ile görünür.

### D4. Kilit olayları audit'e yazılmıyor
- `unlock_with_pin` 5. yanlış (`signed_out`), `clear_my_lock`, `set_my_pin` (değişim) için `_audit` yok. Yönetici, deneme saldırısını ya da PIN değişimini göremez.
- Öneri: Düz PIN olmadan yalnız olay adıyla `_audit` satırı yazın: `pin_lockout`, `pin_changed`, `lock_cleared_by_login`.

### D5. Herkes otomatik kilidi kapatabiliyor (`auto_lock_minutes = 0`)
- Yer: `set_my_auto_lock`, `members_auto_lock_minutes_allowed`. Yönetici hesabı da dahil.
- Öneri: Bu bir politika kararı. En azından yönetici rolünde 0'ı reddedin ya da mağaza düzeyinde üst sınır koyun (`tenant_settings.max_auto_lock_minutes`).

### D6. Canlıya çıkış rehberinde (`docs/kurulum.md`) güvenlik eksikleri
- 3.1 "Secure password change: açık" Y1'i kapatmaz (24 saat kuralı). Rehbere bu sınır yazılmalı.
- 3.5 JWT süresi 900 sn "önerilir" diye geçiyor. Faz 2.5 D2 (iptal edilen oturumun jetonu 1 saat geçerli) ve Y1 ile birlikte zorunlu adım yapılması önerilir.
- 5.4 "Preview için de ekleyebilirsiniz": `SUPABASE_SERVICE_ROLE_KEY` yalnız Production ortamına girilmeli. Her dal yayını service role ile çalışmasın.
- E-posta sağlayıcısı açıkken Supabase sihirli bağlantı / OTP girişi de açıktır. E-postaya erişen (ör. telefonda açık Gmail) kilidi taze girişle kaldırabilir. Y1 düzeltmesiyle bu da kapanır.
- RLS kontrolü: yerelde `public` ve `storage` şemalarında RLS kapalı tablo yok (aşağıda). Canlıda `db push` sonrası aynı sorgunun çalıştırılması rehbere eklenmeli:
  `select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r' and not relrowsecurity;` (boş dönmeli).

### D7. Güvenlik başlıkları yok (X-Frame-Options / CSP frame-ancestors)
- `next.config.ts` yalnız `/sifre-sifirla/*` için başlık veriyor; `/giris` yanıtında `x-frame-options` ve `content-security-policy` yok.
- Oturum çerezleri `SameSite=Lax` olduğu için başka sitedeki çerçevede oturum gitmez; tıklama kaçırma riski düşük.
- Öneri: `headers()` içinde tüm yollar için `X-Frame-Options: DENY` ve `Referrer-Policy: strict-origin-when-cross-origin` verin. Tek satır.

---

## Doğrulanan, sorun yok

- **RLS:** `public` ve `storage` şemalarında RLS kapalı tablo yok (sorgu boş döndü).
- **Kilitliyken müşteri verisi:** customers, daily_assignments, call_attempts, pipeline_events select 0 satır. `list_pool` 42501. Tüm iş RPC'leri `current_member()` -> `_assert_unlocked()` zincirinden geçiyor.
  - `current_member` kullanan RPC'ler: claim_next, claim_queue_status, day_summary, delete_customer(s), distribute_day, import_customers, list_pool, log_call, log_export, mark_absent, reassign_customer(s), report_range(_member), rules_summary_text, set_appointment, set_my_accent, set_my_auto_lock, set_notify_prefs, set_pipeline_stage, take_from_pool, telegram_*, transfer_open_work, upcoming_birthdays.
  - Kilit RPC'leri bilerek hariç.
- **PIN saklama:**
  - Yalnız bcrypt (`extensions.crypt` + `gen_salt('bf')`).
  - `pin_hash`, `pin_failed`, `auto_lock_minutes`, `locked_at` kolonları anon ve authenticated için select/insert/update kapalı (probe).
  - Düz PIN audit'e, `console`'a ya da hata metnine yazılmıyor. Action'lar `toUserMessage`'e gidiyor; 42501 sabit metne çevriliyor.
- **Zayıf PIN kuralı DB'de:** `set_my_pin` -> `_pin_is_weak`; istemci yalnız 6 hane kontrolü yapıyor.
  - Zayıf sayılanlar: 000000, 111111, 123456, 654321, 121212, 123123, 890123.
  - Zayıf sayılmayanlar: 112233, 111222, 102030, 135790.
- **5 yanlış kuralı yarışta tutuyor:**
  - 30 paralel yanlış istek sonrası DB'de `pin_failed = 5`; ardından doğru PIN `{"ok":false,"remaining":0,"signed_out":true}`. `for update` satır kilidi çalışıyor.
  - Kilitliyken `set_my_pin` (mevcut PIN'le de) `Panel kilitli.`
  - Eski kilitli oturum `clear_my_lock` -> 42501 (probe).
- **Proxy:**
  - Kilitliyken `/musteriler`, `/ayarlar` ve server action POST'u, `/pin-belirle`, `/api/export/customers` -> 307 `/kilit`.
  - Muaf yollar yalnız `/api/telegram/webhook` (gizli başlık), `/api/cron/*` (`safeEqual` Bearer, sır yoksa 503) ve tam eşleşen `/sifre-sifirla` yolları.
  - `lock_status` hatasında kapalı kalıyor: oturum kapatılıyor.
- **Yeni RPC'ler:**
  - set_appointment, reassign_customers (500 sınırı, `_can_view`), transfer_open_work (yalnız manager, aynı kiracı), list_pool (telefonsuz), take_from_pool, claim_next (claim_limit, `skip locked`), claim_queue_status, set_my_accent (hex, CHECK de var), delete_customers (500 sınırı, tek transaction, `_delete_customer_core` kiracı + `_can_view`).
  - Hepsi security definer, `search_path = public, pg_temp`, anon kapalı. İç `_` fonksiyonları authenticated'a kapalı (ACL dökümü).
- **pg_net / Vault:**
  - `_call_notify`: `search_path = ''`, public, anon, authenticated ve service_role için execute kapalı; yalnız pg_cron (postgres) çalıştırıyor.
  - Vault: authenticated için `decrypted_secrets` kapalı; `vault` ve `net` şemaları PostgREST'e açık değil (`schemas = ["public","graphql_public"]`).
  - `app_url` yalnız postgres veya service_role ile değişir; ek bir SSRF yüzeyi yok.
  - (Bilgi: `authenticated` için `net.http_post` execute yetkisi pg_net varsayılanı; REST'ten erişilemiyor.)
- **Service role anahtarı istemciye sızmıyor:**
  - İki `admin.ts` de `import "server-only"`; `NEXT_PUBLIC_` yalnız URL ve anon anahtar.
  - `createAdminClient` yalnız ayarlar action/page, cron, telegram route'larında.
- **neon-flow (`threejs-components@0.0.19`, `build/cursors/tubes1.min.js`):**
  - `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `importScripts`, dinamik script ya da `document.cookie`/`localStorage` erişimi yok.
  - Tek `new Function`, three.js TSL `ScriptableNode` kodu; tubes akışında kullanıcı girdisiyle çağrılmıyor.
  - `package.json`'da install betiği yok; lockfile bütünlük özeti kayıt defteriyle aynı.
- **Oturum döngüsü düzeltmesi:** `/giris` ve `/` için `getUser` doğrulaması ve yerel çıkış doğru; açık yönlendirme yok.
- **`scripts/bootstrap.mjs`:**
  - Geçici şifre `crypto.randomInt` ile 16 karakter (4 sınıf); yalnız bir kez ekrana yazılıyor.
  - Kiracı varsa ya da e-posta kayıtlıysa duruyor; hata olursa kullanıcı ve kiracıyı geri alıyor.
  - Anahtarlar yalnız ortam değişkeninden okunuyor.
- **Migration'larda demo veri ya da demo PIN yok:** `000000` ve `Demo1234` yalnız `seed.sql`'de; rehber `--include-seed`'i yasaklıyor.
- **Mevcut probe:** `node scripts/security-probe.mjs` 183/183 PASS.
