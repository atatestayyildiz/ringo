# Faz 1 bağımsız güvenlik ve doğruluk incelemesi

Tarih: 2026-10-04. Kapsam: `supabase/migrations/*.sql` (0600 dahil, çalışan DB'deki hali), `src/` Server Action'lar, proxy, istemci bileşenleri.
Yöntem: kod okuma + canlı yerel DB'de ACL sorgusu + `test-results/security-probe.mjs` (elif@demo.test oturumu, supabase-js, 34 kontrol) + `psql` üzerinde `begin … rollback` içinde rol taklidi (`set local role authenticated` + `request.jwt.claims`). Kalıcı veri değişmedi. `npx supabase test db`: 8 dosya, 158 test PASS.

Bilinen ve paralel şeritte düzeltilen konular (pasif kullanıcı döngüsü, mobil menü, doğum günü seed'i, müşteri silme audit'i, server-only) tekrar edilmedi; yalnız 0600 migration'ındaki yeni kusurlar not edildi.

## Özet

| Seviye | Sayı |
|---|---|
| KRİTİK | 0 |
| YÜKSEK | 1 |
| ORTA | 3 |
| DÜŞÜK | 8 |
| ŞÜPHE | 3 |

Kiracı izolasyonu, ajan yetki yükseltme, iç fonksiyonlara erişim ve service role kullanımı için açık bulunamadı (aşağıda "Doğrulanan, sorun yok").

---

## YÜKSEK

### Y1. `log_call` müşterinin mevcut durumunu kontrol etmiyor: havuz atlatma, kapanmış müşteriyi diriltme, çift sayım
- Yer: `supabase/migrations/20261004000400_rpc.sql:31-36` (yalnız `_can_work` kontrolü), `:56-85` (durumdan bağımsız geçişler). Arayüzde ulaşılabilir: `src/components/bugun/BugunView.tsx:214` ve `:310` (şeritte herhangi bir karta tıklama `setCurId`), `src/components/bugun/FocusCard.tsx:115-116` (sonuç butonları yalnız `busy` ile kilitli, durumla değil).
- Senaryo (kanıt, psql rollback, elif oturumu, bugün elif'e atanmış `pending` müşteri):
  - `no_answer` x3 → `pool | attempts 0 | pool_count 1 | next_call_at 2026-10-11 00:00 TR` (doğru).
  - Aynı müşteriye 4. `no_answer` → `retry | attempts 1 | pool_count 1 | next_call_at = now()`. Müşteri 7 günlük havuzdan anında çıktı; aynı gün tekrar listesinde.
  - `appointment` → `done/appointment`; ardından `busy` → `call_status = retry`, `pipeline_stage = appointment`, `attempts 2`. Randevulu/kapanmış müşteri arama listesine geri döndü, huni ile durum çelişkili.
  - Müşteri bugünkü atamada kaldığı sürece (havuz, done, disqualified dahil) ajan şeritte karta dokunup yeniden sonuç girebiliyor. Çift dokunma/ağ tekrarı da her seferinde `attempts_in_round`'u artırır (idempotency yok).
- Etki: Spec §5 kural motoru (havuz bekleme, max_rounds, kapanış) ajan tarafından istemeden veya kasıtlı atlanabiliyor; `day_summary` ve huni sayıları bozuluyor.
- Öneri: `log_call` başında `if c.call_status not in ('pending','retry') then raise exception 'Bu müşteri için arama kapanmış veya havuzda.' using errcode='22023'` (manager için ayrı bir "yeniden aç" yolu gerekiyorsa açık parametre). `retry` + `next_call_at > now()` (gelecek callback) için de kural belirlenmeli. Arayüzde `FocusCard` sonuç butonlarını `status in (pending, retry)` dışında devre dışı bırak. pgTAP: havuzdaki/`done` müşteriye `log_call` hata vermeli.

---

## ORTA

### O1. `import_customers` yetkili ajan `customers` tablosuna doğrudan INSERT ile kural motorunu ve audit'i atlıyor
- Yer: `supabase/migrations/20261004000300_rls.sql:76-81` (`customers_insert` yalnız `tenant_id` ve yetki kontrol ediyor; kolon kısıtı yok), tablo yetkisi `authenticated=arwm` (insert açık).
- Senaryo (kanıt, psql rollback, elif = `import_customers`): `insert into customers (tenant_id, full_name, phone, call_status, pipeline_stage, assigned_to, source, pool_count, next_call_at) values (auth_tenant_id(),'Probe','05559990003','retry','completed','<Ayşe id>','meta_api',9,'2000-01-01')` → `INSERT 0 1`. Satır `retry/completed`, `assigned_to = Ayşe`, `source = meta_api`, `next_call_at = 2000-01-01` ile oluştu; `audit_log`'da 0 satır. (RETURNING kullanılmazsa SELECT politikası devreye girmiyor.)
- Etki: Ajan sıralamayı manipüle eder (`retry` + en eski `next_call_at` dağıtımda ilk sıraya, `assigned_to`'ya yapışkan gider), başka ajana iş yığar, kaynak bilgisini sahteler; KVKK açısından iz kalmaz.
- Öneri: `customers_insert` politikasını kaldırıp eklemeyi yalnız RPC'ye bırak (`AddCustomerButton` zaten `import_customers` RPC kullanıyor), `revoke insert on public.customers from authenticated`. Alternatif: politikaya `call_status='pending' and assigned_to is null and pool_count=0 and attempts_in_round=0 and pipeline_stage is null and source='manual'` ekle.

### O2. `delete_customer` (yeni 0600 migration): görünürlük kontrolü yok, silinen kişinin adı audit'te açık kalıyor, çift audit satırı
- Yer: `supabase/migrations/20261004000600_delete_customer.sql:17-36`; eski tetikleyici `20261004000200_helpers.sql:279-293` hâlâ aktif.
- Senaryo (kanıt, psql rollback): elif'e `delete_customers` verildi (view_all yok). Elif Ayşe'nin müşterisini `customers` üzerinden göremiyor (0 satır) ama `view_reports` ile `daily_assignments`'tan id'sini görüyor (1 satır). `delete_customer(<id>)` başarılı, müşteri silindi. `audit_log`'da iki satır: `customer_deleted {"full_name": "<tam ad>", "phone": "•••• 0002"}` ve tetikleyiciden `customer_delete {}`.
- Etki: Yetki kapsamı RLS dönemindeki örtük "görebildiğini silebilir" kuralından genişledi; KVKK silme talebinden sonra tam ad süresiz audit'te kalıyor (dosyanın kendi yorumu "tam veri logda kalmaz" ile çelişiyor).
- Öneri: `if not found or not (m.role='manager' or public._can_view(m, c))` kontrolü; audit'te adı maskele (ör. baş harfler) veya hiç yazma; `drop trigger customers_audit_delete` (ya da tetikleyiciyi tek kaynak yap). pgTAP: görünmeyen müşteri silinemez, audit'te tek satır, ad yok.

### O3. `distribute_day(p_day)` herhangi bir gün kabul ediyor; gelecek gün dağıtımı bugünkü atamaların `assigned_to`'sunu değiştirip ajanı bugünkü müşterisinden koparıyor
- Yer: `supabase/migrations/20261004000400_rpc.sql:292-307` (p_day sınırsız), `:277-279` (`assigned_to` koşulsuz güncelleniyor); görünürlük `rls.sql:72` ve `_can_work` `assigned_to = üye` ister.
- Senaryo (kanıt, psql rollback, yönetici): `select distribute_day(tr_today()+1)` → 38 atama; bugünkü atamalardan 2'sinde `customers.assigned_to` başka ajana geçti. Elif'in bugün 13 atama satırı var ama yalnız 11 müşteriyi görebiliyor; kalan 2'sine `log_call` yapamaz. Süresi yarın dolacak havuz müşterileri de bugünden `retry`'a çevriliyor.
- Etki: Yönetici doğrudan RPC ile (UI şu an parametresiz çağırıyor) gün içi listeyi bozabilir; ileride "yarını şimdi dağıt" özelliği eklenirse kendiliğinden tetiklenir.
- Öneri: `distribute_day` içinde `p_day <> tr_today()` ise hata (veya yalnız `p_day >= tr_today()` ve bugün atanmış müşterileri aday dışı bırak: `and not exists (select 1 from daily_assignments d where d.customer_id=c.id and d.day = tr_today() and p_day <> tr_today())`).

---

## DÜŞÜK

### D1. Gelecekte eklenecek fonksiyonlar varsayılan olarak `anon` ve `authenticated`'a açık
- Yer: `rpc.sql:737` tek seferlik `revoke … on all functions`; `pg_default_acl` (canlı DB): `postgres|public|f| anon=X authenticated=X service_role=X`.
- Senaryo: Yeni bir `security definer` fonksiyon `revoke` unutularak eklenirse anon çağırabilir. 0600 bunu doğru yapmış, ama kural tek tek migration disiplinine bağlı.
- Öneri: `alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;` migration'ı; CLAUDE.md'ye "her yeni fonksiyon için açık grant" kuralı.

### D2. Yönetici doğrudan tablo yazımıyla audit'i ve iş kurallarını atlayabiliyor; "son yönetici" koruması yalnız Server Action'da
- Yer: `rls.sql:53-56` (`members_update` tüm kolonlar), `rls.sql:83-86` (`customers_update` tüm kolonlar), `src/components/musteri/CustomerSheet.tsx:251-261` (müşteri düzenleme doğrudan update, audit yok), `src/app/(app)/ayarlar/actions.ts:169-180` (`active` boolean doğrulanmıyor: `"false"` string'i `!active` kontrolünü atlar, DB'ye false yazılır).
- Senaryo: Yönetici PostgREST ile `members.update({role:'agent'}).eq('id', kendisi)` veya `user_id` değiştirebilir; kiracı yöneticisiz kalabilir. Müşteri adı/telefonu/`call_status` değişiklikleri audit'e düşmez (spec §5 "her yazan fonksiyon audit'e yazar" ruhu).
- Öneri: kolon bazlı grant (`revoke update on members from authenticated; grant update (full_name, role, permissions, is_active, absent_on) …`), son aktif yönetici için DB tetikleyicisi, müşteri düzenlemeyi `update_customer` RPC'ye taşı; `setMemberActiveAction`'da `typeof active === 'boolean'`.

### D3. `import_customers` yetkili ajan için telefon varlığı oracle'ı
- Yer: `rpc.sql:584-589` (`duplicates` sayısı), doğrudan insert'te 23505.
- Senaryo: Ajan `import_customers([{full_name:'x', phone:'05XX…'}])` → `duplicates:1` ise numara kiracıda kayıtlı (göremediği müşteri olsa bile); `inserted:1` ise yeni kayıt oluşur.
- Öneri: Spec gereği kabul edilebilir; KVKK açısından not. İstenirse ajanlara yalnız toplam sayı, satır bazlı mükerrer bilgisi yalnız manager.

### D4. `mark_absent` ve `reassign_customer` dağıtım kilidini almıyor; `absent_on` tek tarih
- Yer: `rpc.sql:338-420`, `:425-477` (advisory lock yok), `:371`.
- Senaryo: Sabah cron dağıtımı ile aynı anda `mark_absent` çalışırsa yük hesapları eski veriyle yapılır, dağılım dengesiz olur (unique `(day, customer_id)` mükerrer atamayı engelliyor, veri bozulmaz). Yarın için `mark_absent` bugünkü izni siler.
- Öneri: Her iki fonksiyonda `pg_advisory_xact_lock(hashtext('telefoncu.distribute_day'), hashtext(tenant::text))`; izin için tarih aralığı tablosu (Faz 2).

### D5. Çalışan ekleme kiracılar arası e-posta varlığını sızdırıyor; e-posta listesi tüm kiracıları tarıyor
- Yer: `src/app/(app)/ayarlar/actions.ts:120-125`, `src/app/(app)/ayarlar/_server/admin.ts:18-28`.
- Senaryo: Çok kiracıda A yöneticisi B'deki bir e-postayla çalışan eklemeye çalışır → "Bu e-posta ile zaten bir hesap var". `listAuthEmails` tüm auth kullanıcılarını (en çok 4000) service role ile çeker; istemciye yalnız kendi üyelerininki gider (sızıntı yok), ama 4000 üstünde e-postalar boş görünür.
- Öneri: Faz 2 çok kiracıda genel mesaj; e-postaları `members` user_id listesiyle `getUserById` veya bir `member_emails` view'ı (service role) ile çek.

### D6. Logo URL `http://` kabul ediyor
- Yer: `ayarlar/actions.ts:77-86`, `schema.sql:23`; kullanım `src/app/(app)/layout.tsx:31`.
- Senaryo: Yönetici `http://…` logo girer → HTTPS üretimde karışık içerik uyarısı; dış sunucu tüm çalışanların IP/oturum zamanını görür.
- Öneri: Yalnız `https:`; tercihen Supabase Storage.

### D7. `/giris` marka bilgisini göstermiyor (spec §8)
- Yer: `src/app/giris/page.tsx` (`login_branding` hiç çağrılmıyor; `rpc.sql:722-732` hazır).
- Senaryo: Giriş ekranında marka adı/logosu yok. Güvenlik açısından `login_branding` doğru: 2 kiracıda 0 satır döndü (psql), yalnız `brand_name, brand_color, logo_url` döner (probe).
- Öneri: `giris/page.tsx`'te anon istemciyle `login_branding()`.

### D8. Ham veritabanı hata mesajları kullanıcıya dönüyor
- Yer: `src/app/(app)/yonetim/actions.ts:19`, `ayarlar/actions.ts:54,94,126,140,189,215,237`, `CustomerSheet.tsx:265`.
- Senaryo: Kısıt/RLS hatalarında "new row violates row-level security policy for table …" gibi İngilizce iç ayrıntı ekrana çıkar (spec §8 hata metni kuralı).
- Öneri: `bugun/actions.ts:9-11` desenini (yalnız 22023/42501/P0002 mesajını geçir) ortak yardımcıya taşı.

---

## ŞÜPHE (doğrulanmadı)

- Ş1. Çift dokunma yarışı: `BugunView.tsx:146-151` `busy` kontrolü state kapanışından okunuyor; iki tıklama aynı render içinde gelirse iki `logCallAction` gidebilir. DB tarafında bunu engelleyen bir şey yok (Y1). Tarayıcıda denenmedi.
- Ş2. Spec §5 `log_call` için "müşteriyi görebilen üye" diyor; uygulama `_can_work` (yönetici veya bugün atanmış) istiyor. `view_all_customers` ajanı göremediği değil gördüğü müşteriye de sonuç giremez; `set_pipeline_stage` de aynı (`/huni`'de kart taşıma ajan için hata verir). Bilinçli daraltma olabilir, Şef kararı.
- Ş3. `set_pipeline_stage` ara aşamalar (`visited`, `applied`, `approved`) `call_status`'u değiştirmiyor; `pending` müşteri `approved` aşamasındayken dağıtımda aranmaya devam eder (`rpc.sql:136-139`). Spec bu durumu tanımlamıyor.

---

## Doğrulanan, sorun yok

- Kiracı izolasyonu (psql rollback, ikinci kiracı + yönetici + müşteri oluşturuldu): A yöneticisi B'nin customers/members/tenant_settings satırlarını göremedi; `log_call`, `set_pipeline_stage`, `reassign_customer` (B müşterisi ve B üyesine devir), `mark_absent`, `delete_customer` B'ye karşı reddedildi; `customers.tenant_id`/`members.tenant_id` değiştirme RLS ile, B üyesine `assigned_to` bileşik FK ile reddedildi; `distribute_day` B'ye 0 atama yaptı; B'deki telefonla A'ya içe aktarma serbest (kiracı bazlı unique, doğru).
- Ajan yetki yükseltme (probe): elif kendi `permissions`/`role`'ünü değiştiremedi (0 satır), `members` insert, `tenants` insert, `tenant_settings` update, `call_attempts`/`daily_assignments`/`audit_log` insert reddedildi; başka ajanın müşterisini select/update/delete edemedi; `audit_log` 0 satır; imzası bozuk JWT (`role=service_role`) PGRST301.
- EXECUTE (canlı ACL): `_distribute_day_for`, `run_scheduled_distribution`, `_audit`, `_recipients`, `_has_perm`, `_can_work`, `_can_view` yalnız `postgres`; anon yalnız `login_branding`. Tüm `security definer` fonksiyonlarda `search_path = public, pg_temp`. Dinamik SQL (`execute`) yok; `format()` yalnız sayısal ayarlarla.
- anon: tablolara 42501, `current_member` 42501, `signUp` "Signups not allowed".
- Server Actions: tüm yazanlar ya `getSessionContext()` + rol kontrolü ya da RPC içi doğrulama kullanıyor; `tenant_id` hep oturumdan, istemciden alınmıyor. Service role yalnız `createMemberAction`'da manager kontrolünden sonra; `members` insert `ctx.member.tenant_id` ile. `SUPABASE_SERVICE_ROLE_KEY` istemci paketlerinde yok (`.next/dev/static` taraması).
- Eşzamanlılık: `distribute_day` kiracı başına `pg_advisory_xact_lock` + `unique(day, customer_id)`; `log_call` `for update` satır kilidi. Mükerrer atama yolu bulunamadı.
- Saat dilimi: `tr_today`, `tr_day_start`, havuz dönüşü (bugün+7, TR 00:00 = 21:00 UTC doğrulandı), cron yerel saat hesabı, istemci `+03:00` yorumlaması tutarlı.
- İstemci: `dangerouslySetInnerHTML` yalnız sabit tema betiği; `--brand` hem DB check hem layout regex'iyle; açık yönlendirme yok (`next=` yok, yönlendirmeler sabit yol); `tel:`/`wa.me` normalize edilmiş 11 haneden üretiliyor; `/musteriler` arama terimi PostgREST `or()` için temizleniyor. `npm audit --omit=dev`: 0 açık.

---

## Düzeltme durumu (2026-10-04)

Değişiklikler: `supabase/migrations/20261004000700_review_fixes.sql` (yeni), `supabase/tests/database/09_review_fixes.test.sql` (43 test), `src/components/bugun/{FocusCard.tsx,BugunView.tsx,model.ts,bugun.module.css}`, `test-results/security-probe.mjs` (+5 kontrol). Doğrulama: `npx supabase test db` 9 dosya 201 test PASS; probe 38 kontrol 0 bulgu; `tsc`, `lint`, `npm test` temiz; tarayıcı: `test-results/review-fix-bugun.png`.

| Bulgu | Durum | Not |
|---|---|---|
| Y1 log_call durum kontrolü | Düzeltildi | Yalnız `pending`/`retry`; diğerlerinde 22023 "Bu müşteri için arama kaydı açık değil (durum: …)." Yönetici dahil. Huni ilerlemesi `set_pipeline_stage`. Arayüz: kapalı müşteride sonuç butonları ve not alanı devre dışı, açıklama görünür. `retry` + gelecek geri arama (`next_call_at > now()`) için erken arama serbest bırakıldı (kural kararı gerekirse Şef). |
| O1 doğrudan customers INSERT | Düzeltildi | `customers_insert` politikası kaldırıldı, `insert` yetkisi `authenticated`'tan alındı (yönetici dahil). Ekleme yalnız `import_customers` (zaten audit özet satırı yazıyor; testle kilitlendi). `AddCustomerButton`/`ImportWizard` RPC kullanıyor. |
| O2 delete_customer | Düzeltildi | Yönetici VEYA (`delete_customers` VE `_can_view`). Audit: `initials` ("S. K.") + telefon son 4; `full_name` yazılmaz, 0600 döneminden kalan 2 audit satırı geriye dönük maskelendi. Tetikleyici RPC silmesinde atlanır (tek satır); RPC dışı silmeler (bakım/service role) yine kayda geçer. |
| O3 distribute_day günü | Düzeltildi | Manuel çağrıda gün yalnız bugün (22023). İç fonksiyonda `assigned_to` yalnız `p_day = bugün` iken güncellenir; bugünkü dağıtım, bugünkü atama satırlarıyla `assigned_to`'yu eşitler. |
| D1 varsayılan EXECUTE | Ertelendi | Etkili çözüm `postgres` rolü için global `revoke execute … from public` ister; bu, sonradan kurulan eklenti fonksiyonlarını da (ör. testlerde `pgtap`) kapatır. Öneri: CLAUDE.md'ye "her yeni fonksiyonda açık revoke/grant" kuralı + 09 benzeri ACL testi. |
| D2 yönetici doğrudan yazım | Kısmen | Düzeltildi: `members` için kolon bazlı update (`full_name, role, permissions, is_active, absent_on`; `user_id/tenant_id/id` kapalı), son aktif yönetici DB tetikleyicisi (rol düşürme/pasifleştirme/silme). Ertelendi: `update_customer` RPC + audit (`CustomerSheet.tsx` değişir, şerit dışı); `setMemberActiveAction`'da `typeof active === "boolean"` (şerit dışı `ayarlar/actions.ts`). |
| D3 telefon varlık oracle'ı | Ertelendi | Spec gereği mükerrer sayısı gösteriliyor; ajana yalnız toplam göstermek ürün kararı. |
| D4 kilit / absent_on | Kısmen | `mark_absent` ve `reassign_customer` dağıtım advisory kilidini alıyor. Tarih aralıklı izin tablosu Faz 2 (şema kararı). |
| D5 e-posta varlığı / listeleme | Ertelendi | `src/app/(app)/ayarlar/**` şerit dışı; Faz 2 çok kiracıda genel mesaj + üye bazlı e-posta çekme. |
| D6 logo http:// | Ertelendi | DB kısıtı tek başına sıkılaşırsa `saveBrandAction` İngilizce kısıt hatası döner; önce `ayarlar/actions.ts` doğrulaması `https:` yapılmalı, sonra DB check (şerit dışı). |
| D7 /giris markası | Ertelendi | `src/app/giris/page.tsx` şerit dışı; RPC hazır. |
| D8 ham DB hata metni | Ertelendi | `yonetim`/`ayarlar` actions şerit dışı; `bugun/actions.ts` deseni ortak yardımcıya taşınmalı. Yeni DB hataları Türkçe ve 22023/42501. |
| Ş1 çift dokunma | Düzeltildi (istemci) | `BugunView` `useRef` kilidi; DB tarafında Y1 kapalı müşteride tekrarı engeller. `retry` müşteride hızlı ikinci "Açmadı" hâlâ iki deneme sayar (DB idempotency anahtarı tasarım kararı). |
| Ş2 log_call "görebilen üye" | Ertelendi | Bilinçli daraltma olabilir; Şef kararı. |
| Ş3 ara aşamada aranmaya devam | Ertelendi | Spec tanımlamıyor; ürün kararı. |

Mevcut test değişiklikleri: `02_log_call` ikinci/üçüncü turdan önce havuz dönüşü (dağıtımın yaptığı `pool → retry`) postgres olarak taklit ediliyor; `08_delete_customer` yetkili ajanın sildiği müşteri bugün ona atandı (görünürlük şartı). Not: arayüz doğrulaması için elif'in demo müşterisi "Mustafa Hayalî" Bugün ekranından "Dükkana gelecek" ile tamamlandı (yerel demo verisi).
