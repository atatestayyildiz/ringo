# Telefoncu CRM, Faz 2 spec

Faz 1 (`docs/spec-faz1.md`) üstüne: Telegram bildirimleri, raporlar, dışa aktarma. Faz 1 sözleşmeleri geçerli. Kullanıcıya görünen metinde em dash (—) yok.

## 1. Veri modeli eklemeleri (yeni migration)

```
tenant_settings += (
  telegram_enabled boolean not null default false,
  telegram_bot_username text,          -- bağlantı linki için (t.me/<username>)
  reminder_hour int not null default 15 check (reminder_hour between 0 and 23)  -- tekrar-ara hatırlatması; 2026-10-05 kaldırıldı (kolon duruyor, kullanılmıyor)
)
-- summary_hour, distribution_hour Faz 1'de var.

members += (
  telegram_chat_id bigint,             -- bağlıysa dolu
  telegram_linked_at timestamptz,
  notify_morning boolean not null default true,
  notify_reminder boolean not null default true,  -- 2026-10-05 kaldırıldı (kolon duruyor, kullanılmıyor)
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
| `report_range(p_from date, p_to date) returns jsonb` | Her aktif üye. Kapsam DB'de çağırana göre: manager veya `view_reports` ekip geneli (`scope: 'team'`), diğer çalışanlar yalnız kendi kapsamı (`scope: 'member'`; istemci parametresiyle genişletilemez). `view_reports` kiracı geneli toplamları görür, müşteri listesi görmez. Aralık en fazla 366 gün. Döner: `{ scope, member_id, totals:{attempts, customers_called, reached, appointments, visited, applied, approved, completed, rejected, not_interested, disqualified, pooled, unreachable, new_customers, assigned}, rates:{reach_rate, appointment_rate, visit_rate, close_rate}, by_member:[{member_id, full_name, attempts, reached, appointments, completed}], by_day:[{day, attempts, reached, appointments}], by_outcome:[{outcome, count}], by_source:[{source_detail, customers, appointments, completed}], by_operator:[{operator, customers, completed}] }`. Tanımlar: reached = outcome in (appointment, callback, not_interested, disqualified) olan denemeler; huni sayıları `pipeline_events` stage geçişlerinden (aralıktaki farklı müşteri). Oranlar 0-1, payda 0 ise 0. Gün sınırları Europe/Istanbul. |
| `report_range_member(p_from date, p_to date, p_member uuid) returns jsonb` | Tek çalışanın kapsamı ("Ben" görünümü). manager veya `view_reports` kiracıdaki herhangi bir üyeyi, diğerleri yalnız kendini isteyebilir (başkası 42501). Üye kapsamı: üyenin denemeleri; üyenin yaptığı aşama geçişleri ile üyeye atanmış veya üyenin aradığı müşterilerin geçişleri; üyenin havuz/ulaşılamadı kayıtları; üyeye atanmış yeni müşteriler; üyenin atamaları; `by_member` yalnız üyenin satırı. Ortak gövde iç fonksiyon `_report_range` (istemciye kapalı). |
| `log_export(p_kind text, p_rows int, p_filters jsonb)` | Dışa aktarmayı audit_log'a yazar (action='export'). manager veya `export`. |

Sunucu tarafı (service role, yalnız route handler'larda kullanılan) iç fonksiyonlar, authenticated/anon'a EXECUTE yok:
- `_telegram_consume_link_code(p_code text, p_chat_id bigint) returns jsonb` → `{ok, full_name, tenant_name}` veya `{ok:false, reason:'invalid'|'expired'|'used'}`. Aynı chat başka üyeye bağlıysa önceki bağlantı kaldırılır.
- `_notification_targets(p_now timestamptz) returns table(tenant_id, member_id, kind, chat_id, payload jsonb)`: Saatleri gelen (2026-10-05: dakika bazlı; yerel saat >= distribution_hour:distribution_minute için morning, reminder_hour için reminder (2026-10-05 kaldırıldı), summary_hour:summary_minute için summary) ve o gün o tür için notification_log'da kaydı olmayan, telegram_enabled kiracılardaki, aktif, bağlı ve tercihi açık üyeler. Payload:
  - morning (ajan ve atanmış yönetici): `{first_name, total, retries, new, birthdays:[{full_name, days_left}]}` (bugünkü atamalardan; total 0 ise hedef dönmez).
  - reminder: `{first_name, retry_count}` (bugün atanmış ve hâlâ retry olanlar; 0 ise dönmez). 2026-10-05 kaldırıldı: artık hedef üretilmez (20261005000400_remove_reminder.sql).
  - summary (manager ve view_reports): `{day, totals:{assigned, done, reached, appointments, retries}, members:[{full_name, assigned, done, appointments}]}`.
- `_notification_record(p_tenant uuid, p_member uuid, p_kind text, p_day date, p_status text, p_error text)`.

## 3. Telegram (Next.js)

- `src/lib/telegram/client.ts`: `sendMessage(chatId, text, opts)` Bot API `sendMessage` (parse_mode HTML, metin kaçışlı), 429'da `retry_after` kadar bir kez bekle, hata fırlatır.
- `src/lib/telegram/messages.ts`: saf fonksiyonlar `morningText`, `reminderText`, `summaryText`, `linkedText`, `helpText` (payload → Türkçe metin, uygulama linki `APP_URL` ortam değişkeninden). Vitest testleri.
  - morning örnek: "Günaydın Elif. Bugün 12 kişi aranacak: 3 tekrar arama, 9 yeni. Doğum günü yaklaşan: Hakan Yıldız (3 gün). Listeyi aç: <link>"
  - reminder: "Elif, 4 tekrar araman bekliyor. <link>" (2026-10-05 kaldırıldı)
  - summary: "Bugünün özeti (4 Ekim): 48 atama, 41 tamamlandı, 31 ulaşıldı, 14 randevu, 7 tekrar. Elif 12/12 (5 randevu), ..." 
- `POST /api/telegram/webhook`: `X-Telegram-Bot-Api-Secret-Token` başlığı `TELEGRAM_WEBHOOK_SECRET` ile sabit zamanlı karşılaştırılır, uymazsa 401. `/start <KOD>` → `_telegram_consume_link_code` → yanıt mesajı. `/start` kodsuz veya başka metin → `helpText`. Her zaman 200 döner (Telegram tekrar denemesin), hatalar loglanır.
- `GET|POST /api/cron/notify`: `Authorization: Bearer <CRON_SECRET>` zorunlu. `_notification_targets(now())` → her hedefe mesaj → `_notification_record`. Yanıt: `{sent, failed, skipped}`. `?dry=1` gönderim yapmadan hedefleri ve metinleri döner (test için). Vercel Cron 5 dakikada bir çağırır (`vercel.json`, `*/5 * * * *`; 2026-10-05). Not: Vercel Hobby planında 5 dakikalık cron yok (günde bir); canlıda Vercel Pro ya da bu uç noktayı pg_cron + pg_net ile 5 dakikada bir çağırmak gerekir.
- `POST /api/telegram/test`: oturumlu üye kendine test mesajı (kind='test').
- Service role istemcisi `src/lib/supabase/admin.ts` (`import 'server-only'`), yalnız bu route'larda.

## 4. Arayüz

- `/ayarlar` yeni sekme **Bildirimler** (manager): telegram_enabled anahtarı, bot kullanıcı adı, reminder_hour (2026-10-05 kaldırıldı), sabah (distribution_hour:distribution_minute) ve akşam (summary_hour:summary_minute) saatleri, SS:DD biçiminde (2026-10-05: Kurallar yerine buradan düzenlenir; dakika kolonları `20261005000700_schedule_minutes.sql`, pg_cron dağıtımı 5 dakikada bir, `_scheduled_distribution_at` gün içinde bir kez), ekip listesinde kimin bağlı olduğu, manager başkasının bağlantısını kaldırabilir. Token yoksa uyarı: "Bot anahtarı sunucuya eklenmedi. Kurulum adımları: ..." (BotFather adımları 4 madde).
- **Profil** sayfası `/profil` (herkes, üst çubuktaki kullanıcı hapından): Telegram'ı bağla (kod üret, `https://t.me/<bot>?start=<KOD>` düğmesi + kod metni + 15 dk geri sayım, bağlanınca durumu yenile), bağlantıyı kaldır, tercih anahtarları, "Test mesajı gönder". Şifre değiştir (Supabase `updateUser`).
- **Yetki ayrımı** (migration `20261004001100`): `view_reports` = "Ekibin raporlarını görsün" (Raporlar'da ekip geneli kapsam; Yönetim'i açmaz). `view_team` = "Yönetim ekranını görsün" (ekip özet kartları, kim ne yaptı, `day_summary`, başkalarının `daily_assignments` satırları). Menü: Raporlar herkes, Yönetim manager veya `view_team`, Ayarlar manager. Geçişte `view_reports` sahiplerine `view_team` verildi. Gün sonu Telegram özeti `view_reports` ile kalır.
- **/raporlar** (herkes; kapsam DB'de: manager ve `view_reports` ekip geneli ve "Ekip / Ben" seçimi, diğer çalışanlar yalnız kendi sayıları, çalışan tablosu yok): aralık seçici (Bugün, Bu hafta, Bu ay, Geçen ay, Özel), KPI kartları (oranlarla), günlük trend (SVG hap çubuklar, prototip dili; kütüphane yok), huni (taramalı iz üstünde dolu çubuk), çalışan tablosu, sonuç dağılımı, kaynak (reklam/form) performansı, operatör dağılımı. "Raporu indir (CSV)" (ekip geneli; manager veya `export` ve `view_reports` birlikte, yalnız Ekip görünümünde; kendi kapsamlı CSV yok).
- **Dışa aktarma**: `/musteriler` üst çubuğunda "Dışa aktar" (manager veya `export`), mevcut filtrelerle `GET /api/export/customers?...` → CSV (UTF-8 BOM, `;` ayraç, Excel Türkçe uyumlu), sütunlar: Ad Soyad, Telefon, Operatör, Durum, Aşama, Atanan, Kaynak, Başvuru, Doğum Tarihi, Son Not, Oluşturma. Route oturumu ve yetkiyi sunucuda doğrular, RLS'li istemciyle çeker (yalnız görebildiği), `log_export` çağırır. `GET /api/export/report?from&to` aynı kurallarla rapor CSV'si.

## 5. Test

pgTAP: link kodu (süre, tek kullanım, başkası için üretilemez), iç fonksiyonların authenticated'a kapalı olması, `_notification_targets` saat/tercih/dedup mantığı, `report_range` sayıları seed üzerinde ve yetki, `log_export` yetkisi. Vitest: mesaj metinleri, CSV üretimi (BOM, kaçış, `;`). Route testleri: webhook yanlış sır 401, cron yetkisiz 401, `?dry=1` çıktısı.

## Randevu zamanı (2026-10-05)

Migration `20261005000500_appointment_time.sql`. "Dükkana gelecek" (outcome / `pipeline_stage = 'appointment'`) için gün ve isteğe bağlı saat.

- `customers += (appointment_day date, appointment_time time)`, Europe/Istanbul yerel. İkisi null = "Belli değil, uğrayacak". Check: saat doluysa gün dolu. İstemci bu kolonları doğrudan yazamaz (customers UPDATE kolon bazlı; randevu kolonları hariç), yalnız RPC yazar. Okuma RLS ile aynı.
- `log_call(p_customer, p_outcome, p_note, p_callback_at, p_appointment_day date default null, p_appointment_time time default null)`: eski 4 parametreli imza kaldırıldı, eski çağrılar aynen çalışır. outcome = 'appointment' iken kolonlar parametrelerle set edilir; başka sonuçta parametre verilirse 22023.
- `set_appointment(p_customer uuid, p_day date default null, p_time time default null) returns customers`: randevu aşamasındaki müşterinin zamanını değiştirir/temizler. Yetki `_can_work` (log_call ile aynı; kiracı dışı/yetkisiz 42501). Aşama 'appointment' değilse 22023. audit_log `set_appointment`.
- Doğrulama (iki RPC): gün bugünden (İstanbul) önce olamaz, saat gün olmadan olamaz (22023, Türkçe mesaj).
- `set_pipeline_stage`: başka aşamadan 'appointment'a taşınınca kolonlar null (belli değil); randevudan çıkınca kolonlar korunur. "Gecikti" yalnız `pipeline_stage = 'appointment' and appointment_day < bugün` iken anlamlı (arayüz hesaplar).
- `_notification_targets` morning payload += `appointments_today` (üyeye atanmış, aşama 'appointment', gün = bugün). Hedef koşulu (`total > 0`) değişmedi. Sabah metni sayı > 0 ise "Bugün X müşteri dükkana gelecek." ekler.

## Ortak havuz (2026-10-05)

Migration `20261005000800_shared_pool.sql`. Havuz tüm aktif üyelere açık; çalışan bekleme süresi dolmadan müşteriyi kendi listesine alabilir. customers SELECT RLS'i genişlemez.

- `list_pool()` (security definer, aktif üye): çağıranın kiracısında `call_status = 'pool'` müşteriler; yalnız `id, full_name, operator, pool_count, next_call_at, last_member_name, last_outcome`. Telefon dönmez. Sıra `next_call_at` artan.
- `take_from_pool(p_customer uuid) returns customers`: aktif herhangi bir üye. İzinli (absent_on bugün) 22023. Dağıtım kilidi + `for update`; müşteri havuzda değilse (veya başka kiracı) 22023 "Bu müşteri havuzda değil, başka biri almış olabilir." Etki: `assigned_to` = çağıran, `pending`, `attempts_in_round = 0` (`pool_count` korunur), `next_call_at = now()`; bugünkü `daily_assignments` satırı çağıranın listesinin sonuna eklenir, aynı gün başka üyede satır varsa taşınır. audit_log `take_from_pool`.
- auto_even kiracıda bugün henüz atama yoksa: dağıtım saati geçmişse önce `_distribute_day_for` çalışır (aksi halde zamanlı dağıtım atlanırdı), geçmemişse alma 22023 ile reddedilir.
- Arayüz: `/havuz` listesi `list_pool`'dan; her satırda "Kendime al" (onaysız, işlem sırasında kilitli). Başarıda "X listene eklendi" + Bugün'e git bağlantısı, satır düşer.

## Dağıtım modları (2026-10-05)

Migration `20261005001000_distribution_modes.sql`. `free_pool` ve `manual` çalışır, Ayarlar > Kurallar'da seçilir (spec-faz1 §6.5 "Faz 1'de 0 döner" kuralının yerine geçer). `tenant_settings.claim_limit smallint not null default 3 check (1..50)`.

- Kalıcı kural (tüm modlar): sahibi olan açık müşteri (pending/retry) vakti gelince sahibinin bugünkü listesine konur; "tekrar ara" müşterisi aramayı yapan çalışanda kalır.
- `auto_even`: davranış değişmedi (sabah eşit dağıtım, gün içinde bir kez; havuz dönüşü `retry`, sahibi alıcıysa ona).
- `free_pool` ve `manual`, `_distribute_day_for`: yeni (sahipsiz) müşteri atanmaz. Süresi dolan havuz müşterisi `pending`, `assigned_to = null`, `attempts_in_round = 0` olur (free_pool: "Sıradakini al" kuyruğu; manual: yöneticinin atamasını bekler). Sahibi aktif ve o gün izinli değilse, sahipli vakti gelmiş pending/retry müşteri sahibinin listesinin sonuna eklenir; sahip izinli/pasifse müşteri bekler (yönetici aktarır). audit_log yalnız iş yapıldıysa.
- `_scheduled_distribution_at`: auto_even eskisi gibi (bugün ataması yokken). free_pool/manual dağıtım saatinden sonra her 5 dakikalık çağrıda çalışır (idempotent; `claim_next` erken satır oluşturabildiği için "bugün atama yok" koşulu bu modlarda kullanılmaz).
- `claim_next() returns customers` (aktif üye): mod free_pool değilse 22023 "Bu mağazada serbest havuz kapalı."; izinliyse 22023. Dağıtım kilidi altında: bugünkü listede vakti gelmiş açık (pending/retry, `next_call_at <= now()`) müşteri sayısı `claim_limit`'e ulaştıysa 22023. Önce vakti gelen havuz müşterileri kuyruğa döner; sonra `assigned_to is null`, `pending`, `consent`, `next_call_at <= now()` müşterilerden en eskisi (`next_call_at`, `created_at`) `for update skip locked` ile seçilir, çağırana atanır, bugünkü listesinin sonuna eklenir, audit `claim_next`. Uygun yoksa null.
- `claim_queue_status() returns table(mode, waiting, open_count, claim_limit)` (aktif üye, telefon yok): kuyruktaki (sahipsiz bekleyen + vakti gelmiş havuz) sayı, çağıranın açık sayısı, sınır.
- `take_from_pool`: free_pool'da aynı `claim_limit` sınırı geçerli (listeden seçerek sınır aşılamaz). auto_even kuralı aynen.
- `_reassign_core` (reassign_customer/reassign_customers): free_pool/manual'da vakti gelmiş açık müşteri bugün kimsenin listesinde değilse alıcının (izinli değilse) listesinin sonuna eklenir. auto_even'da eklenmez (erken satır sabah dağıtımını atlatırdı).
- İç `_open_claim_count` istemci rollerine kapalı; `claim_next`, `claim_queue_status` yalnız authenticated.
- Arayüz: Kurallar'da üç mod seçilir; free_pool seçiliyken "Aynı anda en fazla açık müşteri" alanı; canlı özet modu sade anlatır. Bugün: free_pool'da satışçıya üstte "Sıradaki müşteriyi al" kartı (kuyruk sayısı, açık/sınır; sınırda ya da kuyruk boşken düğme kapalı ve açıklamalı); alınca liste yenilenir, müşteri odak kartında (`/bugun?m=`). Yöneticinin Dağıtım kartı: auto_even "Dağıt"; manual "Müşterileri ata" → `/musteriler?atanan=yok`; free_pool yalnız bilgi. Müşteriler çoklu seçimde seçilenlerin hepsi atanmamışsa düğme "Ata".
- Bugün'deki havuz kartı ortak: sayı ve en yakın dönüş `list_pool()`'dan (kiracının tüm havuzu, telefon yok).
- Bilinen sınır: `_notification_targets`'ın kaçan dağıtımı yakalama adımı yalnız auto_even içindir; diğer modlarda sabah mesajı 5 dakikalık dağıtımdan önce koşarsa eksik sayı gösterebilir.

### Dağıtım modları ek kararlar (2026-10-05, kullanıcı)

- Migration `20261005001100_morning_modes.sql`. `_notification_targets` sabah adımı: dağıtım saati geçtiyse hedefler hesaplanmadan önce bugünün moda uygun dağıtımı çalışır (auto_even: bugün ataması yokken, eskisi gibi; free_pool/manual: her çağrıda, idempotent). Böylece sabah sayısı sahibin vakti gelen tekrar aramalarını içerir. Yukarıdaki "Bilinen sınır" maddesi kapandı.
- Serbest havuz modunda Havuz yalnız görüntülenir: `take_from_pool` 22023 "Serbest havuz modunda müşteriler Sıradakini al ile alınır." (auto_even ve manual aynı). Havuz sayfasında "Kendime al" düğmesi yok, üstte not: "Havuzdan dönen müşteriler Sıradakini al kuyruğuna girer." Yukarıdaki "take_from_pool: free_pool'da claim_limit" maddesinin yerine geçer.
- İzinli/pasif çalışanın açık müşterileri (free_pool/manual): değişiklik yok; yönetici "İşlerini aktar" (transfer_open_work) veya Müşteriler aktarımıyla taşır. Karar: mevcut akış yeterli.

## Panel kilidi (2026-10-05)
Tasarım: `docs/superpowers/specs/2026-10-05-kilit-ve-acilis-design.md` §1. Migration `20261005001200_panel_lock.sql`.
- Kilit sunucuda: `members.locked_at`; kolonlar istemciye kapalı, yalnız RPC (`set_my_pin`, `lock_me`, `unlock_with_pin`, `lock_status`, `set_my_auto_lock(integer)`, `clear_my_lock`).
- Kilitliyken customers / daily_assignments / call_attempts / pipeline_events select politikaları 0 satır (`auth_unlocked()`); iş RPC'leri `current_member()` üzerinden 42501 "Panel kilitli.".
- 5. yanlış PIN: `signed_out`, sayaç 5'te kalır ve o oturumdan deneme kabul edilmez; `clear_my_lock` yalnız kilitten sonra açılmış (taze şifreli) oturumda çalışır.
- Proxy tek `lock_status()` çağrısıyla üyelik + PIN + kilit kararını verir (PIN yok → `/pin-belirle`, kilitli → `/kilit`).
- Demo PIN'i `000000` yalnız seed/yerel DB'de doğrudan hash; `set_my_pin` bu PIN'i kabul etmez.
- Üst çubuk: tema, kilit, profil ve çıkış tek hesap menüsünde (avatar tetikleyici, gradyan karartma katmanı).
