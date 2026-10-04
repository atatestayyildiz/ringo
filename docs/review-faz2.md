# Faz 2 bağımsız güvenlik ve doğruluk incelemesi

Tarih: 2026-10-04. Kapsam: `supabase/migrations/20261004000800_faz2.sql`, `src/lib/telegram/**`, `src/app/api/{telegram,cron,export}/**`, `src/lib/supabase/{admin,middleware}.ts`, `src/app/(app)/{profil,raporlar}/**`, `src/app/(app)/ayarlar/notification-actions.ts`, `src/components/{profil,raporlar}/**`, `src/components/ayarlar/NotificationsPanel.tsx`, `src/lib/csv.ts`, `vercel.json`.
Yöntem: kod okuma; canlı yerel DB'de ACL ve kolon yetkisi sorguları; `psql` üzerinde `begin … rollback` içinde rol taklidi (`set local role authenticated` + `request.jwt.claims`); `scripts/security-probe.mjs` (86 kontrol, PostgREST + ham HTTP, localhost:3200). Kalıcı veri değişmedi (probe sonrası `notification_log` 0, `customers` 43, kod tablosu ve audit'te probe izi yok). Faz 1 bulguları (`docs/review-faz1.md`) tekrar edilmedi.

## Özet

| Seviye | Sayı |
|---|---|
| KRİTİK | 0 |
| YÜKSEK | 0 |
| ORTA | 2 |
| DÜŞÜK | 9 |
| ŞÜPHE | 5 |

Webhook/cron kimlik doğrulama, proxy muafiyetleri, iç fonksiyon erişimi, rapor/dışa aktarma yetkisi, kiracı sınırı ve CSV formül koruması için açık bulunamadı (bkz. "Doğrulanan, sorun yok").

## Probe sonucu

`node scripts/security-probe.mjs` → **86 kontrol, 86 PASS, 0 FAIL, exit 0**. Gruplar: F1 RLS (14), iç fonksiyonlar authenticated+anon (21, hepsi 42501), anon (5), F2 DB (19), HTTP (27: webhook/cron sırsız-yanlış sır, 9 proxy yol kaçamağı, export/test oturumsuz ve yetkisiz, /raporlar yetkisiz).

---

## ORTA

### O1. Sabah bildirimi dağıtımla aynı dakikada yarışıyor; saat tam eşleşmesi nedeniyle kaçan bildirim bir daha gönderilmiyor
- Yer: `supabase/migrations/20261004000500_cron.sql:14-18` (pg_cron dağıtımı `0 * * * *`), `supabase/migrations/20261004000400_rpc.sql:327` (`distribution_hour = extract(hour …)`), `vercel.json:2` (bildirim cron'u da `0 * * * *`), `supabase/migrations/20261004000800_faz2.sql:471-473` (`s.distribution_hour = v_hour` ve `x.total > 0`), `src/lib/telegram/notify.ts:33`.
- Senaryo: Saat 08:00'de pg_cron `run_scheduled_distribution` ile Vercel cron `/api/cron/notify` aynı dakikada başlar. Bildirim isteği dağıtım işlemi commit olmadan `_notification_targets` okursa `daily_assignments` boş görünür, `total = 0` olduğu için hedef dönmez ve kayıt da yazılmaz. 09:00'da `distribution_hour = v_hour` artık tutmaz; o günün sabah mesajı hiç gitmez. Aynı sonuç: yönetici dağıtımı gün içinde elle yaparsa, Vercel cron o saati atlarsa/gecikirse ya da yönetici saati geçmiş bir saate çekerse. Kanıt (psql rollback): bugün için 08:00:30 → Elif ve Ayşe'ye morning hedefi (13 atama); 07:59 → 0 hedef; ertesi gün 08:00 (atama yok) → 0 hedef.
- Etki: Ana Faz 2 bildirimi sessizce düşer; hata, log veya kayıt yok.
- Öneri: Eşleşmeyi "yerel saat >= distribution_hour ve bugün için kayıt yok" yap (aynı şekilde reminder ve summary için `>=` + gün sonu sınırı), dedup zaten `notification_log` ile var. Ek olarak bildirim cron'unu `5 * * * *` gibi dağıtımdan sonraya kaydır. pgTAP: dağıtım saatinden 1-2 saat sonra atama varsa morning hedefi dönmeli, kayıt varsa dönmemeli.

### O2. Şifre değiştirme mevcut şifreyi veya yeniden doğrulamayı istemiyor
- Yer: `src/app/(app)/profil/actions.ts:60-75` (`updateUser({ password })`), `supabase/config.toml:229` (`secure_password_change = false`), `:183` (`minimum_password_length = 6`).
- Senaryo: Mağazada ortak kullanılan, açık kalmış bir oturumda (veya çalınmış oturum çereziyle) üçüncü kişi Profil'den eski şifreyi bilmeden yeni şifre koyar; asıl kullanıcı kilitlenir, saldırgan kalıcı erişim kazanır. Diğer oturumlar kapatılmıyor. Ayrıca `updateUser` doğrudan supabase-js ile çağrılırsa action'daki 8 karakter kuralı atlanır (sunucu tarafı en az 6).
- Etki: Oturum ele geçirme kalıcı hesap ele geçirmeye dönüşür.
- Öneri: Formda mevcut şifre iste ve `signInWithPassword` ile doğrula (veya üretimde `secure_password_change = true` + reauthentication nonce); başarıda `signOut({ scope: 'others' })`; üretim Auth ayarında `minimum_password_length = 8`.

---

## DÜŞÜK

### D1. `members.telegram_chat_id` kiracıdaki tüm üyelere açık
- Yer: `supabase/migrations/20261004000300_rls.sql:45-47` (`members_select` tüm kolonlar), `20261004000800_faz2.sql:13-18`.
- Senaryo (psql rollback): Ayşe oturumu `select count(*) filter (where telegram_chat_id is not null) from members` → 1 (Elif'in chat id'si okunabiliyor).
- Etki: Özel sohbette chat id = Telegram kullanıcı kimliği. Ajan, iş arkadaşlarının Telegram kimliğini ve bağlanma zamanını görür; tek başına mesaj gönderme veya hesap ele geçirme sağlamaz. Gizlilik sızıntısı, düşük.
- Öneri: Kolon bazlı select (`revoke select on members from authenticated; grant select (id, tenant_id, user_id, full_name, role, permissions, is_active, absent_on, created_at, notify_*) …`) ve bağlı olma bilgisini `telegram_linked_at is not null` üzerinden veya bir view/RPC ile ver. Profil sayfası ve Bildirimler paneli kendi satırı / yönetici için RPC kullanır.

### D2. `members` INSERT yetkisi yeni Telegram kolonlarını da kapsıyor (migration yorumu ile çelişki)
- Yer: `20261004000800_faz2.sql:20-21` ("yeni kolonlar istemciye açılmaz"), canlı ACL: `authenticated` için `INSERT (… telegram_chat_id, telegram_linked_at, notify_*)`; politika `rls.sql:49-51`.
- Senaryo (psql rollback, yönetici): `insert into members (…, telegram_chat_id, telegram_linked_at) values (…, 4242, now())` yetki kontrolünü geçti (yalnız `user_id` unique ihlaliyle düştü). Atanmış müşterisi olmayan bir üyeyi silip aynı `user_id` ile yeniden ekleyen veya üyeliksiz bir auth kullanıcısı olan yönetici, sohbet sahipliği kanıtı (bağlama kodu) olmadan herhangi bir chat id yazabilir.
- Etki: Kiracının bildirimleri (müşteri adları, ekip özeti) botu başlatmış başka birine (ör. başka kiracının çalışanı) yönlendirilebilir. Yalnız yöneticinin yapabildiği, pratikte zor.
- Öneri: `revoke insert on members from authenticated; grant insert (tenant_id, user_id, full_name, role, permissions, is_active, absent_on) …` (ya da `id/created_at` dahil gerekenler). Yeni üye `createMemberAction` ile ekleniyor, etkilenmez.

### D3. Bildirim gönderimi önce gönderip sonra kaydediyor: eşzamanlı cron çağrısında çift mesaj; başarısız gönderim aynı gün tekrar denenmiyor
- Yer: `src/lib/telegram/notify.ts:58-84`, `20261004000800_faz2.sql:546-559` (`on conflict … do nothing`).
- Senaryo: İki cron çağrısı (Vercel yeniden deneme, elle tetikleme) aynı saatte hedefleri birlikte okur; ikisi de gönderir, kayıt ikincide sessizce yutulur. Ters yönde: Telegram geçici hatası (ör. 5xx, ağ) `failed` olarak kaydedilir; `_notification_targets` kayıt varsa hedef döndürmez (psql: `failed` kaydı sonrası 08:00 hedefinden Elif düştü), mesaj o gün kaybolur.
- Öneri: Önce "talep" satırı yaz (`insert … status='pending' on conflict do nothing returning id`, yalnız dönen satırlar için gönder, sonra güncelle), ya da kiracı başına `pg_try_advisory_lock`. Hedef sorgusunda yalnız `status in ('sent','skipped')` veya `failed` ve deneme sayısı < N kayıtlarını dedup say.

### D4. Bağlama kodu için deneme sınırı yok; ortak bot herkes için tek kod uzayı
- Yer: `src/lib/telegram/webhook.ts:33-52`, `20261004000800_faz2.sql:79-115`, `:373-422`.
- Değerlendirme: Kod 32^8 = 2^40 (yaklaşık 1,1 trilyon), `gen_random_bytes` + `& 31` ile eşit dağılımlı (önyargı yok); üye başına tek etkin kod (yeni kod eskisini siler), 15 dk, tek kullanım. Webhook yalnız Telegram'dan sırla gelir; saldırgan denemeleri Telegram mesajı olarak gönderebilir (sohbet başına yaklaşık saniyede 1). Aynı anda 50 etkin kod varsayımıyla 1 milyon deneme başarı olasılığı yaklaşık 5e-5. Başarılı tahmin saldırganın sohbetini o üyeye bağlar ve üyenin bildirimlerini (müşteri adları, doğum günleri; yöneticide ekip özeti) alır. Ele geçirme riski düşük. Asıl pratik etki: her yanlış denemeye bot yanıt veriyor, tek botun genel gönderim sınırı (yaklaşık 30 mesaj/sn) tüketilirse saat başı bildirimleri 429'a düşer.
- Öneri: Sohbet başına basit sayaç (ör. `telegram_link_attempts(chat_id, window_start, n)`; 10 dakikada 5 başarısız denemeden sonra sessizce yok say), yanıtsız red. Kod uzunluğu yeterli.

### D5. Test mesajı uç noktasında sınır yok
- Yer: `src/app/api/telegram/test/route.ts:11-58`.
- Senaryo: Bağlı herhangi bir üye `POST /api/telegram/test`'i döngüde çağırır; her çağrı bota bir mesaj gönderir ve `notification_log`'a bir `test` satırı yazar (`test` unique indeks dışı, `faz2.sql:54`).
- Etki: Tek ortak botun gönderim kotası tüketilir (diğer kiracıların bildirimleri gecikir/düşer), log tablosu sınırsız büyür. CSRF yok (POST, SameSite=Lax çerez; probe oturumsuz isteğin reddedildiğini doğruladı).
- Öneri: Üye başına dakikada 1 (ör. son `test` kaydının `created_at`'ine bak, 429 dön).

### D6. Müşteri dışa aktarımı 10.000 satırda sessizce kesiliyor; audit filtrelerinde ham arama terimi
- Yer: `src/app/api/export/customers/route.ts:77-82` (kesme), `:114-116` (`filters.q` audit'e), `20261004000800_faz2.sql:187-188`.
- Senaryo: 12.000 müşterili kiracıda dosya 10.000 satırla iner; kullanıcıya veya dosyaya kesildiğine dair bilgi yok (audit'te `rows: 10000`). Arama kutusuna telefon/ad yazılarak yapılan dışa aktarmada bu terim süresiz `audit_log.data.filters.q`'da kalır. Not: `config.toml` `max_rows = 1000` = `CHUNK`; bu değer 1000'in altına düşürülürse döngü ilk parçadan sonra durur ve dışa aktarım 500 gibi bir sayıda kesilir.
- Öneri: 10.000'e ulaşıldıysa `count: 'exact'` ile toplamı al, 413/400 ile "filtreyi daraltın" dön veya `X-Export-Truncated` + son satır notu; döngü bitiş koşulunu `data.length === 0` yap; audit'te `q` yerine `q_len` veya maskeli değer.

### D7. `report_range` görünmeyen müşterileri de sayıyor (tasarım gereği, kayıt altına alınmalı)
- Yer: `20261004000800_faz2.sql:207-366` (security definer, `tenant_id` filtresi var, RLS yok).
- Senaryo (psql rollback, Elif: `view_reports`, `view_all_customers` yok): `customers` üzerinden 13 müşteri görüyor; `report_range('2026-01-01','2026-10-04')` → `new_customers = 43` (kiracının tamamı), `by_member` tüm ekip, `by_source` kiracı geneli.
- Değerlendirme: Dönen veri yalnız toplam sayılar, çalışan adları ve `source_detail` metni; müşteri adı/telefonu yok, kiracı sınırı korunuyor. Spec `view_reports` için kiracı geneli rapor öngörüyor; kabul edilebilir. Tek risk: `source_detail` içe aktarmada serbest metin (dosya adı vb.); buraya kişi verisi yazılırsa raporda görünür.
- Öneri: Spec'e "view_reports kiracı geneli toplamları görür, müşteri listesi görmez" notu; `source_detail` için içe aktarmada uzunluk sınırı/temizleme.

### D8. Telegram'a giden sabah mesajında müşteri adı ve doğum günü
- Yer: `20261004000800_faz2.sql:459-469`, `src/lib/telegram/messages.ts:33-45`.
- Senaryo: Sabah mesajı, doğum günü yaklaşan müşterilerin tam adını ve kalan gün sayısını Telegram sunucularına (yurt dışı) gönderir. Spec gereği, ancak KVKK yurt dışına aktarım ve aydınlatma kapsamında.
- Öneri: Adı baş harf + soyadın ilk harfi ("H. Y.") veya yalnız sayı ("2 müşterinin doğum günü yaklaşıyor") ile gönder; tam ad uygulamada. Ürün/hukuk kararı.

### D9. İzinli (`absent_on`) üye bildirim hedeflerinden dışlanmıyor
- Yer: `20261004000800_faz2.sql:470-475`, `:489-494`.
- Senaryo: `mark_absent` atamaları devrettiği için normal akışta `total = 0` olur ve mesaj gitmez. Ancak `absent_on` yönetici tarafından doğrudan (kolon yetkisi açık, `review_fixes.sql:498`) ya da devir yapılamadığında (alıcı yok) atamalar üyede kalırsa izinli çalışana sabah/hatırlatma gider.
- Öneri: Morning ve reminder koşuluna `and (m.absent_on is distinct from v_day)`.

---

## ŞÜPHE (doğrulanmadı)

- Ş1. Vercel Hobby planında cron en fazla günde bir kez çalışabilir; `vercel.json:2` saatlik ifade (`0 * * * *`) Hobby'de dağıtımı reddettirebilir veya çalışmaz. Proje Pro plan değilse bildirimler hiç gitmez. Plan doğrulanmalı (alternatif: Supabase pg_cron + `pg_net` ile route'u çağırmak).
- Ş2. `members.telegram_chat_id` için unique kısıt yok; `_telegram_consume_link_code` kod satırını kilitliyor, sohbeti değil (`faz2.sql:389`, `:405-412`). İki farklı üyenin kodu aynı sohbetten eşzamanlı tüketilirse iki üye aynı chat'e bağlanabilir. Etkisi küçük (aynı kişi iki üyenin bildirimini alır). Öneri: `create unique index … on members (telegram_chat_id) where telegram_chat_id is not null`.
- Ş3. `report_range` içinde `bm` ve `cs` CTE'leri satır başına `att`/`pe` üzerinde ilişkili alt sorgu çalıştırıyor (`faz2.sql:276-311`); materyalize CTE indekssiz olduğundan 366 günlük aralık ve büyük kiracıda müşteri x deneme ölçeğinde maliyet. `view_reports` yetkili ajan ağır sorgu tetikleyebilir. Ölçülmedi; `statement_timeout` sınırlar. Öneri: `group by customer_id` ön-toplamları ile join.
- Ş4. Telegram özeti `reached` değerini farklı müşteri sayısı olarak (`faz2.sql:521-523`, `day_summary` tanımı), `/raporlar` ise deneme sayısı olarak (`faz2.sql:270`) hesaplıyor. Aynı gün için iki ekranda farklı "ulaşıldı" sayısı görünür. İki spec tanımı farklı; Şef kararı.
- Ş5. Pasifleştirilen üyenin `telegram_chat_id`'si kalıyor; bildirim gitmiyor (`is_active` filtresi, psql ile doğrulandı) ama üye yeniden aktifleşince eski sohbet otomatik geri gelir. Pasifleştirmede bağlantıyı kaldırmak daha temiz olabilir.

---

## Doğrulanan, sorun yok

- Webhook (`webhook.ts:56-71`, `auth.ts:4-8`): sır tanımsızsa 503; başlık yok/boş/yanlış → 401 (probe). Karşılaştırma iki tarafın SHA-256 özeti üzerinde `timingSafeEqual` (uzunluk sızmaz). Yetkili isteğe her durumda 200; yalnız `private` sohbet ve metin mesajı işleniyor. HTML çıktıda isimler kaçışlı (`messages.ts:3-5`; `parse_mode HTML` metin düğümünde tırnak kaçışı gerekmez).
- Cron (`notify.ts:23-27`): Bearer yok → 401, sır tanımsız → 503 (yalnız token varken), yanlış/boş/Basic → 401 (GET ve POST, probe). `?dry=1` müşteri adı içerir ama yalnız sırla.
- Proxy muafiyeti (`middleware.ts:10`): `/api/telegram/webhook` tam eşleşme, `/api/cron/` önek. `/api/cron-x`, `/api/cronx/notify`, `..`, `%2e%2e`, `%2f` varyantları, sonda `/` → 307 `/giris`, 308 veya 404; hiçbiri 200 değil (probe). Muafiyet yalnız oturum yönlendirmesini atlar; route'lar kendi doğrulamasını yapıyor.
- İç fonksiyonlar: canlı ACL `_telegram_consume_link_code`, `_notification_targets`, `_notification_record` yalnız `postgres, service_role`; Faz 1 iç fonksiyonları yalnız `postgres`. PostgREST üzerinden authenticated ve anon için 10 fonksiyonun hepsi 42501 (probe). Sahte imzalı `service_role` JWT reddedildi. Service role istemcisi `server-only` ve yalnız webhook/cron/test route'larında.
- Bağlama kodu (psql rollback): küçük harf kod kabul (upper), ikinci kullanım `used`, süresi geçmiş `expired`, pasif üyenin kodu `invalid`, `null` chat `invalid`, SQL benzeri girdi `invalid` (parametreli). Aynı sohbet ikinci üyeye bağlanınca ilk üyenin bağlantısı kalktı. Kod üretimi yalnız çağıranın kendisi için (`current_member()`); başkası için kod üretilemez. `telegram_link_codes` authenticated'a select/insert 42501.
- `telegram_unlink`: ajan başkası için 42501; yönetici kiracı dışı/var olmayan üye için P0002 (probe). `set_notify_prefs` yalnız kendi satırı. `members.telegram_chat_id`, `telegram_linked_at`, `notify_*` doğrudan UPDATE 42501 (ajan ve yönetici, probe).
- `notification_log`: ajan 0 satır, yönetici insert 42501 (probe).
- `_notification_targets` (psql rollback, telegram açık, 5 üye bağlı): 08:00:30 TR yalnız atanmış aktif ajanlar (yönetici atamasız, Can tercihi kapalı, pasif test üyesi hariç); 07:59 → 0; 15:05 reminder yalnız retry > 0 olanlar; 19:00 summary yalnız yönetici ve `view_reports` (Elif); kayıt sonrası dedup; kayıt günü (`istanbulDay`) ve hedef günü aynı `now` değerinden. Kiracı filtresi tüm alt sorgularda var.
- `report_range`: yetkisiz ajan (Ayşe, Can) ve anon reddedildi; ters aralık ve 366 günden uzun aralık 22023; `current_member()` üyeliksiz çağrıda 42501 fırlattığı için null üye ile boş rapor yolu yok; tüm CTE'ler `m.tenant_id` ile sınırlı.
- Dışa aktarma: oturumsuz → 307 (veri yok), export yetkisiz ajan → 403, `view_reports` var `export` yok (Elif) → müşteri ve rapor 403 (probe). Müşteri listesi RLS'li istemciyle (yalnız görünen), `tenant_id` oturumdan; `log_export` veriden önce başarısız olursa dosya dönmüyor. Dosya adı doğrulanmış tarihlerden.
- CSV (`csv.ts:7-19`): `= + - @ \t \r` ile başlayan metin `'` ile etkisiz; `;`, `"`, satır sonu tırnaklanıyor; sayılar ayrı yol; BOM + CRLF. Önce tırnak sonra önek değil, önek sonra tırnak: doğru sıra.
- `/raporlar`: `requireAccess` ile sunucuda yetki; yetkisiz ajana içerik dönmüyor (probe). Bildirimler paneli ve ayar action'ları `requireManager`; sırlar istemciye yalnız boolean olarak gidiyor. `telegram_bot_username` hem DB check hem action regex'i; `t.me` linki bu değerle kuruluyor.

---

## Düzeltme durumu

Tarih: 2026-10-04. Migration: `supabase/migrations/20261004000900_faz2_review_fixes.sql`. Testler: `supabase/tests/database/11_faz2_review_fixes.test.sql` (62), `src/lib/telegram/routes.test.ts`, `src/lib/telegram/link.integration.test.ts`, `src/app/(app)/profil/password.test.ts`, `scripts/security-probe.mjs` (99 kontrol).

| Madde | Durum | Not |
|---|---|---|
| O1 | Düzeltildi | `_notification_targets` saat koşulu `>=` (morning/reminder/summary, o günün kalanında yakalanır). Telegram açık, `auto_even` kiracıda bugün hiç atama yoksa ve dağıtım saati geçtiyse önce `_distribute_day_for` (idempotent; fonksiyon artık `volatile`). `vercel.json` cron `5 * * * *`. |
| O2 | Düzeltildi | Profil şifre değiştirme mevcut şifreyi ister; oturumdan bağımsız geçici istemcide `signInWithPassword` ile doğrulanır (yanlışsa "Mevcut şifre hatalı."), başarıda `signOut({ scope: 'others' })`. **Canlı için öneri:** Supabase Auth'ta `secure_password_change = true` ve `minimum_password_length = 8` (doğrudan supabase-js `updateUser` çağrısını da kapatır). `config.toml` değiştirilmedi. |
| D2 | Düzeltildi | `members` INSERT kolon bazlı: `authenticated` yalnız `id, tenant_id, user_id, full_name, role, permissions, is_active, absent_on, created_at`. Telegram/notify kolonları insert ve update ile yazılamaz. |
| D3 | Düzeltildi | Önce sahiplen (`_notification_claim`, `status='sending'`, `attempts`), gönder, sonra `_notification_finish`. Hedef dışı: `sent`/`skipped`, son 10 dk içindeki `sending`, `attempts >= 3`. `failed` ve yarım kalmış `sending` en fazla 3 denemeye kadar yeniden sahiplenilir. Bot anahtarı yoksa sahiplenme/kayıt yok. `_notification_record` uyumluluk için duruyor, uygulama kullanmıyor. |
| D4 | Düzeltildi | `telegram_link_attempts` (RLS açık, istemci yetkisi yok). Sohbet başına saatte 5 başarısız kod denemesinden sonra kod kontrol edilmez, `rate_limited` döner, bot yanıt vermez. 24 saatten eski kayıtlar her denemede silinir. |
| D5 | Düzeltildi | Test mesajı üye başına dakikada 1 (`_notification_claim` kind `test`, üye satırı kilitli); aşımda 429. |
| D6 | Kısmen | 10.000 satır aşılırsa `X-Export-Truncated: 1` ve `X-Export-Total`; Müşteriler sayfasında "En fazla 10.000 satır" notu. Döngü dönen satır sayısı kadar ilerler, boş sayfada durur (`max_rows` < 1000 olsa da eksik kalmaz). Ertelendi: audit'te ham `q` (ürün kararı: maskeleme mi, uzunluk mu). Rapor CSV'si satır sınırlı değil (özet tablo), notu yok. |
| D1 | Düzeltildi (2. tur) | `authenticated` için `members` SELECT kolon bazlı: `telegram_chat_id` hariç tüm kolonlar (`telegram_linked_at`, `notify_*` dahil). Ajan ve yönetici `telegram_chat_id` okuyamaz, filtrede kullanamaz, `select *` 42501. Profil, Profil durum action'ı ve Bildirimler paneli bağlı olmayı `telegram_linked_at` ile okur; `/api/telegram/test` chat id'yi oturum doğrulamasından sonra service role ile okur. Diğer istemci okumaları zaten açık kolon listesiydi. |
| D7 | Ertelendi | Tasarım gereği; spec notu ve `source_detail` temizliği ürün kararı. |
| D8 | Ertelendi | KVKK/ürün kararı (ad maskeleme). |
| D9 | Düzeltildi (2. tur) | `_notification_targets` morning ve reminder koşuluna `absent_on is distinct from v_day`. Dünkü/yarınki izin bugünü etkilemez; summary değişmedi. |
| Ş1 | Açık | Vercel planı doğrulanmalı (Hobby'de saatlik cron yok). |
| Ş2 | Düzeltildi (2. tur) | `members_telegram_chat_id_key` kısmi unique indeks (`where telegram_chat_id is not null`; yerel veride çakışma yoktu). `_telegram_consume_link_code` eski bağlantıyı zaten kaldırıyordu; eşzamanlı tüketimde unique ihlali yakalanır, `invalid` döner (500 yok), kod kullanılmamış kalır. |
| Ş3-Ş5 | Ertelendi | Ş3 performans ölçümü, Ş4 tanım kararı, Ş5 pasifleştirmede bağlantı kaldırma: ayrı tur. |

2. tur (D9, Ş2, D1): migration `supabase/migrations/20261004001000_faz2_review_fixes2.sql`; testler `supabase/tests/database/12_faz2_review_fixes2.test.sql` (30), `src/lib/telegram/link.integration.test.ts` (istemci chat id okuyamaz, eşzamanlı tüketimde sohbet tek üyede), `scripts/security-probe.mjs` (104 kontrol).

Uyarlanan eski testler (`10_faz2.test.sql`): "09:00'da hedef yok" → 07:00 (>= kuralı); "reminder saatinde başka tür yok" → yalnız summary; "retry 0 ise hedef yok" yalnız reminder türüne bakar; "failed yeniden denemeyi engeller" → 1 hedef (D3); "export audit yazmaz" kiracıya göre filtrelendi (yerel DB'deki e2e dışa aktarma kayıtları testi bozuyordu).
