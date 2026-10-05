# Panel kilidi ve açılış/kapı animasyonu (2026-10-05)

Kullanıcı onaylı tasarım. İki parça: (1) PIN kilidi (güvenlik), (2) açılış sahnesi ve kapı animasyonu (motion).

## 1. Kilit sistemi

Karar: kilit **sunucuda** tutulur (yalnız ekran perdesi değil).

### Veri (members)
- `pin_hash text null`: bcrypt (`extensions.crypt(pin, gen_salt('bf'))`). Düz PIN hiçbir yerde saklanmaz, loglanmaz.
- `pin_failed smallint not null default 0`: art arda yanlış deneme sayacı.
- `auto_lock_minutes smallint not null default 10` (0 = kapalı; izin verilen: 0, 5, 10, 15, 30).
- `locked_at timestamptz null`: dolu = panel kilitli.
- İstemci bu kolonları doğrudan okuyamaz/yazamaz (kolon grant'ları); yalnız RPC.

### RPC (security definer, search_path sabit, revoke public/anon, grant authenticated)
- `set_my_pin(p_new text, p_current_pin text default null)`: 6 hane rakam; zayıf PIN reddi (tek rakam tekrarı 111111, ardışık 123456/654321 ve benzerleri). PIN zaten varsa `p_current_pin` doğru olmalı; yoksa (ilk belirleme) gerekmez. Hata 22023 Türkçe.
- `lock_me()`: `locked_at = now()`.
- `unlock_with_pin(p_pin text) returns jsonb {ok, remaining, signed_out}`: doğruysa `locked_at = null, pin_failed = 0`. Yanlışsa `pin_failed + 1`; 5'e ulaşınca `pin_failed = 0`, `locked_at` kalır ve sonuç `signed_out = true` (istemci/sunucu oturumu kapatır, e-posta + şifre gerekir).
- `lock_status() returns jsonb {locked, has_pin, auto_lock_minutes}`.
- `set_my_auto_lock(p_minutes smallint)`.
- E-posta + şifre ile yeniden girişte `locked_at` ve `pin_failed` sıfırlanır (giriş action'ı `clear_my_lock()` çağırır; yalnız taze oturumda anlamlı).

### Zorlama
- `_assert_unlocked()` iç yardımcı: çağıranın `locked_at` doluysa 42501 "Panel kilitli." Panel verisi okuyan/yazan RPC'ler ve RLS politikaları bu kontrolü içerir (kilitliyken müşteri verisi okunamaz). Kapsam: customers / daily_assignments / call_attempts / pipeline_events select politikaları ve iş RPC'leri. Kilit RPC'leri ve `lock_status` hariç.
- proxy: oturum varsa ve `lock_status().locked` ise uygulama sayfaları `/kilit`e yönlendirilir; `has_pin = false` ise `/pin-belirle`ye. `/kilit`, `/pin-belirle`, `/giris`, sıfırlama ve public uçlar hariç.
- Çok sekme: kilitlenince `BroadcastChannel('telefoncu-lock')` ile diğer sekmeler de kapıyı kapatır; ayrıca sayfa görünür olunca `lock_status` kontrolü.

### Akışlar
- İlk giriş: PIN yoksa `/pin-belirle` (geçilemez; iki kez gir, eşleşmeli).
- Kilit düğmesi: masaüstü üst menüde tema düğmesinin yanında asma kilit; mobilde üst çubukta ve hamburger menüde.
- Otomatik kilit: pointer/touch/klavye/scroll hareketi olmadan `auto_lock_minutes` dolunca `lock_me()` ve kapı kapanır. Zamanlayıcı tüm sekmelerde ortak (localStorage son etkinlik zamanı, try/catch).
- "PIN'i unuttum": kilit ekranından e-posta + şifre girişine (yerel oturum kapatılır, sonra /giris).
- Profil > "Güvenlik" kartı: PIN değiştir (mevcut PIN ile), otomatik kilit süresi (Kapalı/5/10/15/30 dk).

## 2. Açılış sahnesi ve kapı (motion)

Yol: saf CSS + Web Animations API + SVG/clip-path; yeni bağımlılık yok. Hareket dili: ışık ve derinlik.

### Sahne (`src/components/scene/`)
- Arka plan: mağaza renginden (`--brand`) türetilmiş 3-4 büyük bulanık ışık bulutu, 20-40 sn döngülerle süzülür; üstte taralı doku çok hafif.
- Ortada yuvarlak logo (tenant logosu; yoksa mağaza adının baş harfi). Etrafında iki ince ışık halkası farklı hızda döner, üçüncüsü 4 sn'lik nefes döngüsü; halka üzerinde kayan ışık noktaları.
- Paralaks: masaüstünde imleç, telefonda dokunma-sürükleme ile katmanlar farklı oranda kayar (eğim sensörü yok).
- Giriş koreografisi (~1.2 sn): halkalar sırayla çizilir, logo hafif ölçekle oturur, form alttan süzülür.
- Form cam kartta; kilit ekranında 6 PIN noktası + rakam tuş takımı; tuşta halka nabzı, yanlışta noktalar sallanır ve halka kısa kırmızı.
- Giriş öncesi logo: dağıtımın kiracısı için yalnız `brand_name, brand_color, logo url` döndüren public, salt okunur uç (müşteri verisi yok). Kiracı seçimi ortam değişkeni (`PUBLIC_TENANT_ID`) ile; yoksa tek kiracı varsayımı.

### Kapı açılışı (~1.6 sn)
1. Form söner, logo halkası parlar (0.3 sn).
2. Logo çerçevesinden sağ üst ve sol alt köşeye iki ışıklı çizgi çizilir, uçta parlak nokta (0.5 sn).
3. Ekran bu köşegen boyunca iki parçaya bölünür (clip-path); sol üst yarı sol üste, sağ alt yarı sağ alta kayar (ease-in-out, sonda yumuşak; 0.8 sn), kesik kenarlar bir an parlar.
4. Arkada önceden yüklenmiş panel hafif yakınlaşmayla belirir.

### Kapanma (kilit)
Ters koreografi: yarılar köşelerden kayıp köşegende birleşir, ek yeri parlar, çizgiler logoya çekilir, PIN ekranı belirir. Kapı kapanınca panel içeriği DOM'dan kaldırılır (kilit sayfasına geçiş).

### Erişilebilirlik ve performans
- `prefers-reduced-motion`: tüm hareket kapalı, kapı yerine 200 ms solma.
- Yalnız transform/opacity/clip-path animasyonu; hedef orta seviye Android'de 60 fps. Sekme gizliyken animasyonlar durur.
- Kapı her girişte ve kilit açılışında oynar; aynı oturumda sayfa geçişlerinde oynamaz.

## Test
- pgTAP: PIN kuralları, bcrypt, 5 yanlışta signed_out, kilitliyken veri okuma/yazma reddi, ACL.
- security-probe: anon reddi, kilitliyken customers select reddi.
- e2e: ilk giriş PIN belirleme, kilitle, PIN ile aç, 5 yanlış, otomatik kilit (kısa süreyle), çok sekme, reduced-motion yolu, yenilemeyle kilidin aşılamaması.

## Uygulama sırası
1. Kilit sistemi (Opus): DB, proxy, /kilit ve /pin-belirle işlevsel sayfalar, kilit düğmesi, otomatik kilit, Profil Güvenlik kartı.
2. Sahne ve kapı (Sonnet, paralel): `src/components/scene/` bileşenleri, /giris entegrasyonu; ardından /kilit ve kilit geçişine entegrasyon.
3. Bağımsız güvenlik incelemesi (Opus, yazan ≠ inceleyen).
