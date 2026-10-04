# Telefoncu CRM, Faz 1 spec

White label müşteri takip sistemi. İlk müşteri: tek telefon mağazası (hat %90, cihaz %10). Meta "acil nakit" reklam formundan gelen kişiler ertesi gün aranır. Çalışan sabah kendi listesini görür, aramaları işler; yönetici ekibi ve sonuçları izler.

Bu dosya şeritler arası sözleşmedir. Burada yazan isimler (tablo, kolon, fonksiyon, rota) değiştirilmez; değişiklik gerekirse Şef'e rapor edilir.

## 1. Yığın

- Next.js (App Router, en güncel kararlı), TypeScript strict, Tailwind CSS v4, `@supabase/ssr`, `@supabase/supabase-js`.
- Supabase: Postgres, Auth (e-posta + şifre, kayıt kapalı), RLS, `pg_cron`. Yerel geliştirme: `npx supabase start` (Docker).
- Testler: veritabanı için pgTAP (`npx supabase test db`), saf TS için Vitest, uçtan uca için Playwright.
- Paket yöneticisi: npm. Saat dilimi her yerde `Europe/Istanbul`.
- UI metni Türkçe. Kullanıcıya görünen metinde em dash (—) kullanılmaz; virgül, iki nokta veya nokta kullan.

## 2. Çok kiracıya hazırlık

Her iş tablosunda `tenant_id uuid not null references tenants`. Faz 1'de tek kiracı vardır, kiracı yönetim ekranı yoktur. Kullanıcının kiracısı `members` tablosundan bulunur. Marka (ad, renk, logo) `tenant_settings`'ten okunur; arayüzde sabit marka adı yazılmaz.

## 3. Veri modeli (schema `public`)

```
tenants(id uuid pk default gen_random_uuid(), name text not null, created_at timestamptz default now())

tenant_settings(
  tenant_id uuid pk references tenants on delete cascade,
  brand_name text not null default 'Marka Adı',
  brand_color text not null default '#FF5E2B',      -- #RRGGBB
  logo_url text,
  max_attempts int not null default 3,              -- tur başına başarısız deneme
  pool_wait_days int not null default 7,
  max_rounds int not null default 2,                -- müşteri havuza en fazla bu kadar kez düşer
  distribution_mode text not null default 'auto_even' check (distribution_mode in ('auto_even','free_pool','manual')),
  distribution_hour int not null default 8,         -- sabah dağıtım saati (yerel)
  summary_hour int not null default 19,             -- akşam özeti (Faz 2 Telegram kullanır)
  birthday_notice_days int not null default 3
)

members(
  id uuid pk default gen_random_uuid(),
  tenant_id uuid not null references tenants,
  user_id uuid not null unique references auth.users on delete cascade,
  full_name text not null,
  role text not null check (role in ('manager','agent')),
  permissions jsonb not null default '{}'::jsonb,   -- anahtarlar §4
  is_active boolean not null default true,          -- false: giriş yapamaz, dağıtım almaz
  absent_on date,                                   -- bu tarihte yok (izinli); dağıtım o gün atlar
  created_at timestamptz default now()
)

customers(
  id uuid pk default gen_random_uuid(),
  tenant_id uuid not null references tenants,
  full_name text not null,
  phone text not null,                              -- normalize: 05XXXXXXXXX (11 hane)
  phone_alt text,
  operator text check (operator in ('VF','TC','TT')),
  birth_date date,
  source text not null default 'manual' check (source in ('manual','import','meta_api')),
  source_detail text,                               -- form/reklam adı, dosya adı
  applied_at timestamptz,                           -- forma başvuru zamanı
  call_status text not null default 'pending' check (call_status in ('pending','retry','pool','done','unreachable','disqualified')),
  pipeline_stage text check (pipeline_stage in ('appointment','visited','applied','approved','rejected','completed','not_interested')),
  attempts_in_round int not null default 0,
  pool_count int not null default 0,                -- kaç kez havuza düştü
  next_call_at timestamptz not null default now(),  -- bu zamandan itibaren aranabilir
  assigned_to uuid references members,
  last_outcome text,
  last_note text,
  consent boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (tenant_id, phone)
)

daily_assignments(
  id uuid pk default gen_random_uuid(),
  tenant_id uuid not null references tenants,
  day date not null,
  customer_id uuid not null references customers on delete cascade,
  member_id uuid not null references members,
  position int not null,                            -- gün şeridindeki sıra
  created_at timestamptz default now(),
  unique (day, customer_id)
)

call_attempts(
  id uuid pk default gen_random_uuid(),
  tenant_id uuid not null references tenants,
  customer_id uuid not null references customers on delete cascade,
  member_id uuid not null references members,
  outcome text not null check (outcome in ('appointment','callback','no_answer','busy','disqualified','not_interested','wrong_number')),
  note text,
  callback_at timestamptz,
  created_at timestamptz default now()
)

pipeline_events(id, tenant_id, customer_id, member_id, stage text, note text, created_at)   -- stage: pipeline_stage değerleri

audit_log(id bigserial pk, tenant_id, member_id uuid null, action text, entity text, entity_id uuid, data jsonb, created_at)
```

İndeksler: `customers(tenant_id, call_status, next_call_at)`, `customers(tenant_id, assigned_to)`, `daily_assignments(tenant_id, day, member_id)`, `call_attempts(customer_id, created_at desc)`.

## 4. Roller ve yetkiler

- `manager`: her şey.
- `agent`: varsayılan dar yetki. Yalnız bugün kendine atanmış ve `assigned_to = kendisi` olan müşterileri görür. Yönetici aşağıdaki anahtarları tek tek açar (`members.permissions`, boolean):
  - `view_all_customers`: tüm müşterileri görür (sadece okuma).
  - `import_customers`: müşteri ekler, Excel içe aktarır.
  - `reassign`: müşteriyi başka çalışana devreder.
  - `export`: listeyi dışa aktarır (Faz 2 düğmesi, anahtar şimdiden var).
  - `view_reports`: yönetim ekranındaki ekip/özet kartlarını görür.
  - `delete_customers`: müşteri siler (KVKK silme talebi).
- Ayarlar (kurallar, marka, ekip, yetki) yalnız `manager`.

## 5. Veritabanı fonksiyonları (RPC sözleşmesi)

Hepsi `security definer`, `search_path = public`, ilk iş çağıranın üyeliğini ve kiracısını doğrular, yetkisizse `raise exception` (mesaj Türkçe). Her yazan fonksiyon `audit_log`'a satır ekler. Saat hesapları `Europe/Istanbul`.

| Fonksiyon | İş |
|---|---|
| `current_member() returns members` | Çağıranın aktif üyeliği; yoksa hata. RLS yardımcıları: `auth_tenant_id()`, `auth_member_id()`, `auth_is_manager()`, `auth_has_perm(text)` (stable, security definer). |
| `normalize_tr_phone(text) returns text` | Rakam dışını at; `90` ile başlayıp 12 haneyse `0`+son 10; 10 hane ve `5` ile başlıyorsa `0` ekle; sonuç `05` ile başlayan 11 hane değilse `null`. immutable. |
| `log_call(p_customer uuid, p_outcome text, p_note text default null, p_callback_at timestamptz default null) returns customers` | Kural motoru, aşağıda. Çağıran: müşteriyi görebilen üye. |
| `set_pipeline_stage(p_customer uuid, p_stage text, p_note text default null) returns customers` | `pipeline_stage` günceller, `pipeline_events` ekler. `completed`, `rejected`, `not_interested` ise `call_status='done'`. |
| `distribute_day(p_day date default (now() at time zone 'Europe/Istanbul')::date) returns int` | §6. Yönetici çağırabilir; `pg_cron` her kiracı için `distribution_hour`'da çağırır. Idempotent. Atanan yeni satır sayısını döner. |
| `mark_absent(p_member uuid, p_day date default today) returns int` | Üyeyi o gün yok say (`absent_on = p_day`), o günkü bitmemiş atamalarını diğer aktif çalışanlara eşit dağıt. Yalnız manager. |
| `reassign_customer(p_customer uuid, p_member uuid) returns customers` | manager veya `reassign`. `assigned_to` ve bugünkü atamayı taşır. |
| `import_customers(p_rows jsonb, p_source_detail text) returns jsonb` | Satırlar: `{full_name, phone, phone_alt?, operator?, birth_date?, applied_at?, note?}`. Telefonu normalize eder; geçersizi atlar; aynı kiracıda telefon varsa mükerrer sayar ve eklemez. Döner: `{inserted, duplicates, invalid, invalid_rows:[{index, reason}]}`. manager veya `import_customers`. |
| `upcoming_birthdays(p_days int default null) returns table(customer_id, full_name, birth_date, days_left int)` | Görünür müşterilerden doğum günü `p_days` (null ise ayardaki) gün içinde olanlar. Yıl dönümü hesabı 29 Şubat'ı 28 Şubat sayar. |
| `day_summary(p_day date default today) returns table(member_id, full_name, assigned int, done int, reached int, appointments int, retries int)` | manager veya `view_reports`. |
| `rules_summary_text() returns text` | Ayarlardan düz Türkçe kural özeti. Örnek: "Ulaşılamayan müşteri aynı gün tekrar aranır. 3 başarısız denemeden sonra havuza düşer ve 7 gün sonra listeye geri çıkar. Havuza en fazla 2 kez düşer, sonra 'ulaşılamadı' olarak kapanır." |

### log_call kural motoru

`s = tenant_settings`. Her çağrı `call_attempts` satırı ekler, `last_outcome`, `last_note`, `updated_at` günceller.

- `appointment`: `call_status='done'`, `pipeline_stage='appointment'`, `pipeline_events` satırı.
- `not_interested`: `call_status='done'`, `pipeline_stage='not_interested'`.
- `disqualified` (icra, kredi notu düşük vb.; nedeni nottadır) ve `wrong_number`: `call_status='disqualified'`.
- `callback`: `p_callback_at` zorunlu ve gelecekte. `call_status='retry'`, `next_call_at=p_callback_at`. Deneme sayılmaz.
- `no_answer`, `busy`: `attempts_in_round += 1`.
  - `attempts_in_round < s.max_attempts`: `call_status='retry'`, `next_call_at = now()` (aynı gün tekrar listesinde).
  - aksi halde `pool_count < s.max_rounds` ise: `call_status='pool'`, `pool_count += 1`, `attempts_in_round = 0`, `next_call_at = now() + s.pool_wait_days gün` (o günün yerel 00:00'ına yuvarlanır).
  - aksi halde: `call_status='unreachable'`.

## 6. Dağıtım (distribute_day)

1. Aday: `call_status in ('pending','retry','pool')`, `next_call_at < (p_day + 1)` yerel gece yarısı, o gün için zaten atanmamış. `pool` olup süresi dolanlar `retry`'a çevrilir.
2. Sıra: önce `retry` (eski `next_call_at` önce), sonra `pending` (eski `applied_at`/`created_at` önce).
3. Alıcılar: `role='agent'`, `is_active`, `absent_on is distinct from p_day`. Hiç ajan yoksa aktif yöneticiler.
4. `auto_even`: `retry` müşteri, `assigned_to` hâlâ alıcılar arasındaysa ona gider. Kalanlar, o günkü toplam yükü en az olana (eşitlikte isim sırası) tek tek verilir. `assigned_to` güncellenir. `position` üye başına 1'den artan.
5. `free_pool` ve `manual`: Faz 1'de fonksiyon atama yapmaz, 0 döner. Arayüzde yalnız `auto_even` seçilebilir; diğerleri ayarda "yakında" görünür.
6. Fonksiyon aynı gün tekrar çağrılırsa yalnız yeni adayları ekler (gün içinde içe aktarılanlar).

## 7. RLS

Tüm tablolarda RLS açık. Ortak koşul: `tenant_id = auth_tenant_id()`.

- `tenants`, `tenant_settings`, `members`: select tüm üyeler. update/insert/delete yalnız manager (members için yeni kullanıcı oluşturma sunucu tarafında service role ile yapılır).
- `customers` select: manager veya `view_all_customers` veya `assigned_to = auth_member_id()`. insert: manager veya `import_customers`. update: yalnız manager (ajanlar RPC kullanır). delete: manager veya `delete_customers`.
- `daily_assignments` select: manager veya `view_reports` veya `member_id = auth_member_id()`. Yazma yalnız fonksiyonlar.
- `call_attempts`, `pipeline_events` select: ilgili müşteriyi görebilen. Yazma yalnız fonksiyonlar.
- `audit_log` select yalnız manager. Yazma yalnız fonksiyonlar.

## 8. Ekranlar (Faz 1)

Tasarım dili: `tasarim/bugun.html` prototipi kaynak gerçektir (token'lar, hap dili, gün şeridi, taramalı doku, kart gölgeleri, açık/koyu tema). `--brand` değeri `tenant_settings.brand_color`'dan gelir. Masaüstünde üstte hap menü, 1180px altında alttan yüzen hap menü. Mobil öncelikli; "Ara" butonu `tel:` bağlantısıdır.

| Rota | Kim | İçerik |
|---|---|---|
| `/giris` | herkes | E-posta + şifre. Marka adı/logosu ayardan. |
| `/bugun` | herkes | Selam + kalan sayı, gün şeridi (bugünkü atamalar, `position` sırası, durum rengi), sıradaki müşteri kartı (ad, numara, operatör, kaynak, başvuru zamanı, deneme sayısı, geçmiş notlar, Ara, WhatsApp `https://wa.me/90XXXXXXXXXX`), 6 sonuç butonu (Dükkana gelecek=appointment, Sonra ara=callback + tarih/saat seçici, Açmadı=no_answer, Meşgul=busy, Uygun değil=disqualified + not, İlgilenmiyor=not_interested), not alanı, tekrar aranacaklar (deneme noktaları), havuz kartı, doğum günü kartı, `rules_summary_text()`. Manager'da ek: ekibin bugünkü ilerlemesi ve "Dağıt" düğmesi. Sonuç sonrası otomatik sıradakine geçer. |
| `/musteriler` | görebildiği kadar | Arama (ad/telefon), filtre (durum, aşama, operatör, atanan), liste. Satıra tıklayınca detay paneli: bilgiler (düzenle: manager), doğum günü, huni aşaması değiştir, deneme ve aşama geçmişi, devret (yetkiye göre), sil (yetkiye göre). "Müşteri ekle" ve "Excel içe aktar" (manager veya `import_customers`). |
| `/musteriler/ice-aktar` | aynı | .xlsx/.xls/.csv yükle, ilk satırdan sütun eşleme (otomatik tahmin: ad, soyad, telefon, operatör, doğum tarihi, tarih, not), önizleme (geçerli/geçersiz/mükerrer işaretli), onayla. CSV kodlama: önce UTF-8, `�` çıkarsa `windows-1254` ile yeniden çöz. "Ad" ve "Soyad" ayrı sütunsa birleştir. |
| `/havuz` | görebildiği kadar | `call_status='pool'` listesi, dönüş tarihi ve kalan gün, havuz sayısı. |
| `/huni` | görebildiği kadar | Aşama sütunları (appointment, visited, applied, approved, completed; rejected ve not_interested ayrı katlanır), kart taşıma menüyle (sürükle-bırak gerekmez), aşama sayıları ve dönüşüm oranları. |
| `/yonetim` | manager veya `view_reports` | Bugünün özeti (`day_summary`), çalışan kartları, son işlemler (`call_attempts` + `pipeline_events` son 30), "Bugün yok" işaretle (`mark_absent`, manager). |
| `/ayarlar` | manager | Sekmeler: Kurallar (sayılar + canlı düz Türkçe özet), Ekip (çalışan ekle: ad, e-posta, geçici şifre; rol; yetki anahtarları; pasifleştir), Marka (ad, renk, logo URL, canlı önizleme). |

Boş durumlar yön gösterir ("Bugün listen boş. Yönetici dağıtım yapınca burada görünecek."). Hata mesajları ne olduğunu ve ne yapılacağını söyler.

## 9. Sunucu tarafı

- `src/lib/supabase/{server,client,middleware}.ts` standart `@supabase/ssr` kurulumu. Oturumsuz kullanıcı `/giris`'e yönlenir.
- Çalışan oluşturma: Server Action, `SUPABASE_SERVICE_ROLE_KEY` ile `auth.admin.createUser` + `members` insert; çağıranın manager olduğu sunucuda doğrulanır. Service role istemciye asla gitmez.
- Ortam: `.env.local` (git'e girmez). `.env.example` anahtar adlarını boş değerle listeler.

## 10. Seed ve test verisi (yalnız yerel)

`supabase/seed.sql`: 1 kiracı ("Demo Mağaza"), 1 yönetici + 3 çalışan (e-postalar `@demo.test`, şifreler seed dosyasında), 40 kurgusal müşteri (gerçek kişi/numara kullanılmaz), birkaç geçmiş deneme ve havuz örneği, biri 3 gün sonra doğum günü.

## 11. Kapsam dışı (Faz 2/3)

Telegram, web push, rapor sayfası ve dışa aktarma, Meta API, kiracı yönetim ekranı, `free_pool`/`manual` dağıtım arayüzü.
