# Faz 2.5 bağımsız güvenlik incelemesi (rapor kapsamı, logo, şifre sıfırlama)

Tarih: 2026-10-04. Kapsam: `git diff 6590806..HEAD` (20177fe, 1ed07eb, 61ca41a, 37eb012..4416d90).
Yöntem: kod okuma; canlı yerel DB'de `psql` ile `begin … rollback` içinde rol taklidi (`set local role authenticated` + `request.jwt.claims`, işlem içinde ikinci kiracı ve üye); Supabase Storage/Auth REST denemeleri; Next server action'larını doğrudan HTTP ile çağırma (dev sunucu `localhost:3200`); `node scripts/security-probe.mjs` (**139 kontrol, 139 PASS**). Kalıcı veri bırakılmadı: geçici `review-reset*@demo.test` kullanıcıları, geçici üye satırı, Mailpit iletileri ve deneme dosyaları silindi (son kontrol: `auth.users` 5, `brand-logos` nesne 0, `tenant_settings.logo_url` null, probe üyesine ait audit 0).

## Özet

| Seviye | Sayı |
|---|---|
| KRİTİK | 0 |
| YÜKSEK | 0 |
| ORTA | 1 |
| DÜŞÜK | 7 |
| ŞÜPHE | 3 |

Yetkisiz çalışanın ekip geneli rapor, başka çalışanın raporu veya başka kiracı verisi alabildiği bir yol bulunamadı. Logo deposunda kiracılar arası yazma/silme, yol kaçamağı, SVG/HTML yükleme yok. Şifre sıfırlamada açık yönlendirme, CSRF ve proxy muafiyeti kaçamağı yok. Asıl zayıflık: sıfırlama isteğinde hesap varlığı yanıt süresinden okunabiliyor (O1).

---

## ORTA

### O1. Şifre sıfırlama isteği yanıt süresiyle hesap varlığını sızdırıyor
- Yer: `src/lib/password-reset.ts:23` (`await send(value)` yanıttan önce bekleniyor), `src/app/sifre-sifirla/actions.ts:12-15`.
- Senaryo (kanıt): Gövde her durumda aynı (`"Bu e-posta kayıtlıysa bağlantı gönderdik…"`, iki yanıt bayt bayt eşit). Ancak GoTrue kayıtlı hesap için e-postayı SMTP ile eş zamanlı gönderiyor, kayıtsız hesapta hemen dönüyor. Yerel ölçüm (Mailpit, yani en hızlı SMTP):
  - Doğrudan GoTrue `/auth/v1/recover`: kayıtsız 15-17 ms, kayıtlı 46-67 ms.
  - Uygulama action'ı (`POST /sifre-sifirla`, Next-Action): kayıtsız 51, 53, 72 ms (bir aykırı 337), kayıtlı 73, 96, 114, 126 ms.
  Canlıda harici SMTP (Resend/SES vb.) ile fark yüzlerce ms olur; birkaç tekrarla ayırt etmek kolaylaşır. `max_frequency` aşıldığında kayıtlı hesap da hızlı döner, ama ilk istek her zaman ayırt edicidir.
- Etki: Spec ve `docs/sifre-sifirlama.md` "hesap varlığı sızmaz" diyor; zamanlama ile çalışan e-posta listesi doğrulanabilir (ardından parola deneme / oltalama hedefi).
- Öneri: Gönderimi yanıttan ayır: `import { after } from "next/server"; after(() => supabase.auth.resetPasswordForEmail(email))` ve hemen genel mesajı dön. Ek olarak sabit taban gecikme (ör. toplam süreyi 400 ms'e tamamla) zamanlama gürültüsünü kapatır. Birim testi: `send` 500 ms bekleyen sahte ile action süresi < 100 ms.

---

## DÜŞÜK

### D1. Sıfırlama kodu eşzamanlı gönderimde birden çok kez kullanılabiliyor (GoTrue yarışı)
- Yer: `src/app/sifre-sifirla/yeni/actions.ts:9-24`, `src/lib/password-reset.ts:60-79`; kök neden GoTrue `/verify`.
- Senaryo (kanıt): Aynı `token_hash` ile 2-3 paralel form gönderimi: 1. denemede `OK,DEAD,DEAD`, 2. ve 3. denemede `OK,OK` ve `OK,OK,OK` (hepsi `/giris?sifre=yenilendi`'ye yönlendi, son yazılan şifre geçerli oldu). Doğrudan GoTrue'ya 3 paralel `POST /auth/v1/verify {type:recovery}` → `[200, 200, 200]` (üç ayrı oturum). Sıralı yeniden kullanım doğru şekilde reddediliyor; eski e-postadaki kod da yenisi gelince geçersiz.
- Etki: Kodu zaten ele geçirmiş biri için ek güç vermez; "tek kullanımlık" garantisi yarışta tutmuyor ve kullanıcı ile saldırgan aynı anda "başarılı" görebilir. Uygulamanın kendi hatası değil.
- Öneri: Kabul edilebilir; belgeye "tek kullanım GoTrue'ya dayanır, eşzamanlı istekte garanti yok" notu. İstenirse action'da `token_hash` özetine göre kısa süreli kilit (ör. `pg_advisory_xact_lock` RPC) veya Supabase sürümü yükseltildiğinde yeniden dene.

### D2. Sıfırlamadan sonra eski erişim JWT'si PostgREST'te süresi bitene kadar geçerli
- Yer: `src/lib/password-reset.ts:78` (`signOut({ scope: "global" })`), `supabase/config.toml:166` (`jwt_expiry = 3600`).
- Senaryo (kanıt, geçici üye): Sıfırlama öncesi oturum çereziyle `/bugun` → 200. Sıfırlama sonrası: eski refresh token → 400, `GET /auth/v1/user` → 403, uygulama `/bugun` ve `/musteriler` → 307 `/giris` (uygulama tarafı doğru kapanıyor). Ancak aynı access token ile `GET /rest/v1/customers` → **200** (kalan süre 3598 sn).
- Etki: Oturumu çalınmış kullanıcı şifresini sıfırlasa da saldırgan elindeki JWT ile PostgREST/RPC üzerinden en fazla 1 saat daha işlem yapabilir. `docs/sifre-sifirlama.md` "tüm oturumlar kapatılır" diyor; bu yalnız yenileme ve uygulama için doğru.
- Öneri: Belgeye sınırı yaz. Daha sıkı: `auth_member_id()`/`current_member()` içinde `exists (select 1 from auth.sessions where id = (auth.jwt()->>'session_id')::uuid)` kontrolü (iptal edilen oturum anında düşer) veya canlıda `jwt_expiry` 900 sn.

### D3. Sıfırlama kodu URL'de kalıyor; sayfada Referrer-Policy yok
- Yer: `supabase/templates/recovery.html:7`, `src/app/sifre-sifirla/yeni/page.tsx:7-9`, `next.config.ts` (başlık yok).
- Senaryo (kanıt): `GET /sifre-sifirla/yeni?token_hash=…` yanıtında `referrer-policy`, `x-frame-options`, CSP yok; kod HTML içinde 5 kez geçiyor (gizli input + RSC yükü). Sayfada dış kaynak yok (Referer ile dışarı sızma şu an yok), tarayıcı varsayılanı `strict-origin-when-cross-origin`. Kod sayfa açılınca tüketilmediği için 1 saat boyunca tarayıcı geçmişinde ve sunucu/proxy erişim günlüklerinde geçerli kalıyor.
- Etki: Ortak cihazda (mağaza bilgisayarı) geçmişten kod alınıp şifre değiştirilebilir. Düşük olasılık.
- Öneri: Sayfa açılınca istemcide `history.replaceState(null, "", "/sifre-sifirla/yeni")` (kod gizli inputta kalır); `next.config` `headers()` ile bu yola `Referrer-Policy: no-referrer` ve `Cache-Control: no-store`. Canlı günlük sağlayıcısında sorgu dizesi maskelemesi.

### D4. Logo adresi doğrulaması üç yerde tutarsız
- Yer: `src/lib/brand-logo.ts:40,44-50`, `src/app/(app)/layout.tsx:31`, `supabase/migrations/20261004000100_schema.sql:23`.
- Senaryo (kanıt, `node --experimental-strip-types` ile fonksiyon çağrısı): `javascript:`, `data:`, `http://evil…`, `http://127.0.0.1:54321@evil…` reddediliyor (doğru). Ancak:
  1. `isOwnLogoUrl` ham `startsWith` kullanıyor: yerelde `…/object/public/brand-logos/../../../rest/v1/members` kabul ediliyor (tarayıcı `…/storage/v1/rest/v1/members`'a normalleştirir). Canlıda Supabase adresi https olduğu için http dalı devreye girmez; etkisi yalnız yerel.
  2. Uygulama kabuğu `settings.logo_url`'ü doğrulamadan `<img src>`'ye koyuyor. DB kontrolü `^https?://`; yönetici PostgREST ile doğrudan `http://herhangi-bir-host/x.png` yazabilir (action atlanır), kabukta karışık içerik ve iç ağ isteği (`http://192.168.…`) olur. Giriş sayfası ise doğruluyor.
  3. Herhangi bir https ana makine kabul edildiği için giriş sayfası (anon) ziyaretçi IP'sini yöneticinin seçtiği sunucuya gönderir (değişiklikten önce de vardı).
- Etki: Yalnız yönetici yapabilir; XSS yok (`<img>` `javascript:` çalıştırmaz). İzleme/karışık içerik.
- Öneri: `isOwnLogoUrl`'ü `new URL()` ile kur: `u.origin === new URL(sb).origin && u.pathname.startsWith("/storage/v1/object/public/brand-logos/") && !u.pathname.includes("/../")` (normalleşmiş `pathname` ile karşılaştır). Kabukta da `isAllowedLogoUrl` uygula. DB kontrolünü `^https://` ya da `^https://|^http://(127\.0\.0\.1|localhost)` yapan yeni migration.

### D5. Bozuk yüzde kodlu kayıtlı logo adresi yükleme action'ını patlatıyor
- Yer: `src/lib/brand-logo.ts:56` (`decodeURIComponent`), `src/app/(app)/ayarlar/brand-logo-actions.ts:25-30, 73, 94`.
- Senaryo (kanıt): `ownLogoPath("<sb>/storage/v1/object/public/brand-logos/x%E0", …)` → `URIError` fırlatıyor. Böyle bir adres `saveBrandAction` ile kaydedilebilir (https veya kendi önek). Sonraki `uploadLogoAction` DB'yi yeni logoya günceller, ardından `removeOldLogo` istisna atar: kullanıcı hata görür (Next genel hata), logo aslında değişmiştir, eski dosya silinmez.
- Etki: Yöneticinin kendine verdiği tutarsızlık; güvenlik etkisi yok.
- Öneri: `ownLogoPath` içinde `try { decodeURIComponent } catch { return null }`; `removeOldLogo` çağrısını `try/catch` ile sar.

### D6. Magic bytes denetimi yalnız action'da; yönetici Storage API ile doğrudan rastgele içerik barındırabilir
- Yer: `supabase/migrations/20261004001200_brand_logo_storage.sql:4-9, 20-26`, `src/lib/brand-logo.ts:24-31`.
- Senaryo (kanıt, yönetici JWT ile `POST /storage/v1/object/brand-logos/<tenant>/…`): `…-poly.html` adlı, PNG başlığı + `<script>` içeren dosya `content-type: image/png` ile 200; kamu GET `content-type: image/png`, `x-content-type-options` yok, `content-disposition` yok. `image/png; charset=utf-8` de kabul. Bucket `image/svg+xml`, `text/html` ve `image/png, text/html` → 415; 600 KB → 413 (doğru).
- Etki: İçerik `image/png` olarak sunulduğu için tarayıcı HTML/SVG olarak çalıştırmaz; XSS yok. Yönetici 512 KB'a kadar keyfi baytı kamu adresinde tutabilir (dosya barındırma), uzantı serbest.
- Öneri: Kabul edilebilir. Sıkılaştırma: insert politikasına `and lower(storage.extension(name)) in ('png','jpg','webp')` ve yalnız `logo-` önekli ad (`storage.filename(name) ~ '^logo-[0-9a-f-]{36}\.(png|jpg|webp)$'`).

### D7. `view_team` ve `view_reports` sınırları örtüşüyor
- Yer: `supabase/migrations/20261004001100_report_scope_view_team.sql:297` (`day_summary`), `:331-341` (`daily_assignments_select`), `src/app/(app)/yonetim/page.tsx:22`, `src/components/ayarlar/shared.ts:43-48`.
- Senaryo (kanıt, psql rollback; Can'a yalnız `view_team`):
  - `report_range` → `scope = member` (doğru), `report_range_member(Elif)` → 42501 (doğru).
  - `day_summary()` → 3 satır (tüm ekip, ad + atanan/biten/ulaşılan/randevu); Yönetim'deki gün seçiciyle geçmiş her gün için çalışan bazlı döküm alınabiliyor.
  - `daily_assignments` → 38 satır, 26'sı başkalarının (müşteri UUID'leri); `customers` yine yalnız 12 (RLS), `call_attempts` 1. Ad/telefon sızmıyor.
  - Ters yön: `view_reports` açık, `view_team` kapalı üye Yönetim menüsünü görmez ama `day_summary`'yi RPC ile çağırabilir ve Telegram gün sonu özetini alır.
- Etki: Gizli veri sızıntısı yok; "Yönetim ekranını görsün" yetkisi pratikte ekip performans geçmişini de açıyor ve ayar açıklaması bunu söylemiyor. Ayrıca `view_team`-yalnız çalışanın Yönetim "son işlemler" akışı RLS nedeniyle neredeyse boş (işlevsel not).
- Öneri: Ürün kararı. Ya `shared.ts` açıklamasına "ekibin günlük sayılarını (geçmiş günler dahil) görür" ekle, ya da `day_summary` geçmiş gün için `view_reports` şartı koy. `day_summary` `view_reports` dalı kasıtlıysa yorumla belgele.

---

## ŞÜPHE (doğrulanmadı)

- Ş1. Tüm Auth çağrıları (giriş, `resetPasswordForEmail`, `verifyOtp`) Next sunucusundan gidiyor; GoTrue'nun IP başına sınırları (`token_verifications = 30`/5 dk, `sign_in_sign_ups = 30`/5 dk) canlıda sunucunun (Vercel) çıkış IP'sine uygulanır ve tüm kullanıcılar paylaşır. Saldırgan uygulama üzerinden 30 sahte kod göndererek herkesin sıfırlamasını 5 dk kilitleyebilir; kayıtlı birkaç adres için tekrar tekrar istek göndererek saatlik `email_sent` kotasını tüketebilir (kullanıcı yine "gönderdik" görür, e-posta gelmez). Yerelde sınırlar başka geliştirici işlerini bozmamak için tetiklenmedi. Öneri: action'da istemci IP + e-posta başına kendi sayacı (ör. `pg` tablosu veya Upstash), GoTrue çağrısına gerçek IP başlığı (Supabase `X-Forwarded-For` desteği ve `GOTRUE_RATE_LIMIT_HEADER`) ya da captcha.
- Ş2. Canlı güvenliği yalnız belgeye dayanıyor: `max_frequency` (yerel `1s`, `config.toml:232`), `email_sent`, Site URL ve şablon panelden elle girilecek. Site URL yanlış girilirse e-postadaki bağlantı başka alan adına gider. Kod içinde doğrulama yok; dağıtım kontrol listesine eklenmeli.
- Ş3. Doğruluk (güvenlik değil): `_report_range` üye kapsamında `pe` (`20261004001100_report_scope_view_team.sql:78-83`) üyenin zaman sınırı olmadan **herhangi bir zamanda** aradığı müşterilerin aralıktaki tüm aşama olaylarını sayar. Aylar önce bir kez arayıp sonra başkasına devredilen müşteri başkası tarafından satışa döndüğünde ilk çalışanın "tamamlandı" sayısına da girer; iki çalışanın toplamı ekip toplamını aşabilir. Şef kararı.

---

## Doğrulanan, sorun yok

**Rapor kapsamı ve yetki (20177fe)**
- ACL (canlı): `_report_range` yalnız `postgres, service_role`; `report_range`, `report_range_member`, `day_summary` `authenticated` (+service_role), `anon` yok; `_has_perm`, `_can_view`, `_can_work` yalnız `postgres`. Tümü `security definer` + `search_path = public, pg_temp`; gövdelerde tüm tablo ve fonksiyonlar `public.` nitelikli.
- psql rollback, Ayşe (yetkisiz): `report_range` → `scope=member`, `by_member` 1 satır (kendisi); `report_range_member(Elif)` ve başka kiracı üyesi → 42501; kendisi → `member`; `_report_range(...)` doğrudan → `permission denied`; `day_summary` → 42501; `daily_assignments` başkalarının satırı 0; `_has_perm` → permission denied.
- Elif (`view_reports`): `scope=team`, `new_customers=43`; başka kiracının üyesi için `report_range_member` → 42501 (`_report_range` üye-kiracı kontrolü). Dönen anahtarlarda müşteri adı/telefonu yok.
- İkinci kiracı üyesi: `report_range` tüm sayılar 0 (kiracı 1 verisi yok), kiracı 1 üyesi için `report_range_member` → 42501, `day_summary` → 42501.
- Pasif üye → `current_member()` 42501; anon → permission denied; ters aralık ve `null` tarih → 22023; 366 gün sınırı korunuyor.
- Geçiş: yalnız `permissions->'view_reports' = true` olanlara `view_team` (canlıda Elif, Test Çalışan). Yeni üye `permissions: {}` (`ayarlar/actions.ts:129`) → `view_team` yok. `setPermissionAction` anahtar beyaz listesi `view_team`'i içeriyor; değer `'true'::jsonb` ile karşılaştırıldığı için `"true"` metni yetki vermez.
- UI: Yönetim `requireAccess(canViewTeam)`; Raporlar yetkisiz için `report_range_member(member.id)` (kapsam DB'de); rapor CSV'si `export`+`view_reports` ve ek olarak `scope !== "team"` → 403. `access.ts` yalnız menü/sayfa açar, veriyi genişletmez.

**Logo (1ed07eb)**
- Storage (canlı, yönetici/ajan JWT): Ayşe ve Elif kendi kiracı önekine yükleme → RLS 403; yönetici başka kiracı öneki, kök, `<tenant>/../<diğer>/`, `<tenant>/%2e%2e/<diğer>/` → 403; SVG ve `text/html` → 415; 600 KB → 413. Anon ve ajan listeleme → `[]`; ajan silme → hiçbir şey silinmedi. Probe: yönetici yükler, anon kamu URL okur, silince erişilemez.
- Action: `requireManager` sunucuda; boyut okunmuş bayta uygulanıyor; tür magic bytes'tan, bildirilen türle uyuşmazlık reddediliyor; yol sunucuda `tenantId/logo-<uuid>.<ext>` (istemci yol vermiyor); DB güncellemesi başarısızsa yeni dosya siliniyor. Eski dosya yalnız kendi kiracı önekinde ve tek seviyede siliniyor (`ownLogoPath`); RLS ayrıca koruyor. Eşzamanlı iki yükleme en kötü yetim dosya bırakır, kullanımdaki logo silinmez (sıralama analizi).
- `isAllowedLogoUrl`: `javascript:`, `data:`, kimlik bilgisi içeren `http://127.0.0.1:54321@evil…`, harici http → red. http dalı yalnız `NEXT_PUBLIC_SUPABASE_URL` http iken (yerel) açılıyor; canlıda karışık içerik yolu yok.

**Şifre sıfırlama (61ca41a)**
- Proxy muafiyeti (kendi denemeler, `--path-as-is`): yalnız `/sifre-sifirla`, `/sifre-sifirla/yeni` ve normalleşen `/sifre-sifirla/./yeni` 200; sonda `/` ve `//sifre-sifirla` → 308 kanonik yola; `/SIFRE-SIFIRLA`, `%2F`, `%73`, `..`, `..%2F`, `%2e%2e`, `;`, `%00`, `/yeni/x`, `/yeni.txt`, `-x`, `?x=/sifre-sifirla` → 307 `/giris`.
- Muaf yola başka sayfanın action ID'si: `loadNotificationsAction` ID'si `/sifre-sifirla` ve `/giris`'te aynı davranıyor (`200 {}`; `/giris` zaten oturumsuz açıktı, yeni yüzey yok); bilinmeyen ID 404. Tüm `"use server"` dosyalarında oturum kontrolü ya da RLS'li istemci var.
- CSRF: farklı `Origin` ile action → 500 (Next origin denetimi). Yanıt metni kayıtlı/kayıtsız/biçim dışı hata dışında aynı.
- Açık yönlendirme: `redirect("/giris?sifre=yenilendi")` sabit; `resetPasswordForEmail` `redirectTo` almıyor; e-posta bağlantısı `site_url`'den (`http://localhost:3200`), istek Host başlığından değil. `?sifre=yenilendi` yalnız sabit metinli bir bildirim gösterir.
- Kod: biçim `^[A-Za-z0-9_-]{8,128}$`; şifre uyuşmazlığı ve kısa şifre doğrulamadan önce kontrol edildiği için kodu yakmıyor (kanıt: uyuşmazlıktan sonra aynı kod çalıştı); sıralı yeniden kullanım ve eski e-postanın kodu → "Bağlantı geçersiz". Sayfa açmak kodu tüketmiyor.
- Oturum sabitleme: `statelessClient` (`persistSession:false`) tarayıcı çerezine dokunmuyor; sıfırlama sonrası geçici oturum dahil tüm refresh token'lar iptal (D2 sınırı hariç). Eski şifre → 400, yeni şifre → 200.

**UI (37eb012..4416d90)**
- `dangerouslySetInnerHTML` yalnız `src/app/layout.tsx:30` sabit tema betiği. `<style>{--brand}` her iki yerde `HEX` ile doğrulanmış. Özel `Select` gizli input değeri istemci durumundan; sunucu ve DB zaten kendi doğrulamasını yapıyor, güven sınırı değişmedi. Çıkış onayı: `İptal` `type="button"` (form göndermez), onayda aynı `signOutAction` (supabase-js varsayılanı `global` kapsam, önceki davranışla aynı).

**Probe:** `node scripts/security-probe.mjs` → 139/139 PASS; çalıştırma sonrası `brand-logos` nesnesi 0, `auth.users` 5.
