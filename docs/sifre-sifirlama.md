# Şifre sıfırlama ve marka logosu: canlıya çıkış notları

## Akış
1. `/sifre-sifirla`: e-posta girilir, Supabase `resetPasswordForEmail` çağrılır. Yanıt hesap var olsa da olmasa da, gönderim hata verse de (hız sınırı dahil) aynıdır: "Bu e-posta kayıtlıysa bağlantı gönderdik." Hata yalnız sunucu günlüğüne kod olarak yazılır.
2. E-postadaki bağlantı `{{ .SiteURL }}/sifre-sifirla/yeni?token_hash=...&type=recovery` adresine gider (şablon: `supabase/templates/recovery.html`). Kod sayfa açılınca değil, form gönderilince doğrulanır (e-posta tarayıcılarının önceden açması kodu tüketmez); PKCE çerezi gerekmez, bağlantı başka cihazda da açılabilir.
3. Başarıda şifre güncellenir, kullanıcının tüm oturumları kapatılır (`signOut` scope `global`) ve `/giris?sifre=yenilendi` sayfasına yönlenir. Kod tek kullanımlıktır, 1 saat geçerlidir (`otp_expiry = 3600`).
4. `/sifre-sifirla` ve `/sifre-sifirla/yeni` oturumsuz erişilir. `src/lib/supabase/middleware.ts` içinde yalnız TAM yol eşleşmesiyle muaf tutulur; `/sifre-sifirla-x` gibi varyantlar `/giris`e yönlenir (güvenlik probunda denetlenir).

## Hız sınırı (Supabase Auth'a dayanır)
- Kullanıcı başına bekleme: `auth.email.max_frequency` (yerelde 1s; canlıda en az 60s olmalı).
- Saatlik e-posta kotası: `auth.rate_limit.email_sent` (yerelde 30; Supabase'in yerleşik SMTP'sinde sabit ve çok düşüktür, kendi SMTP'nizde panelden artırılır).
- IP başına sınır Supabase Auth'ta yerleşiktir (Dashboard > Authentication > Rate Limits). Uygulama ek bir sayaç tutmaz.
- Bu sınırlar aşılırsa kullanıcı yine aynı genel yanıtı görür; sınırı aşan istek e-posta üretmez.

## Canlı için gerekenler
1. **SMTP**: Dashboard > Authentication > SMTP Settings (Resend, Postmark, SES vb.). Yerleşik SMTP yalnız takım üyelerine gönderir ve çok düşük kotalıdır; canlıda kendi SMTP'niz şart. Gönderen alan adı için SPF/DKIM/DMARC kaydı ekleyin.
2. **Site URL ve yönlendirme**: Authentication > URL Configuration. `Site URL` = canlı uygulama adresi (şablondaki `{{ .SiteURL }}` buradan gelir). `Redirect URLs` içine `https://<alan-adı>/sifre-sifirla/yeni` ekleyin. Yerel `config.toml` yalnız `http://localhost:3200` içindir.
3. **E-posta şablonu**: Authentication > Email Templates > "Reset Password". Konu: `Şifreni sıfırla`. Gövde: `supabase/templates/recovery.html` içeriği (bağlantı biçimi bozulmamalı: `{{ .SiteURL }}/sifre-sifirla/yeni?token_hash={{ .TokenHash }}&type=recovery`). Yerel `config.toml` bunu otomatik uygular, canlıda panelden elle yapıştırılır ya da `supabase config push` kullanılır.
4. `secure_password_change` ve `minimum_password_length` ayarlarına dokunulmadı. Uygulama en az 8 karakter ister (ek olarak 72 karakter üst sınır: bcrypt).

## Yerelde deneme
`npx supabase start` sonrası gönderilen e-postalar Mailpit'e düşer (`npx supabase status` içindeki `MAILPIT_URL`, genelde http://127.0.0.1:54324). `config.toml` değiştiyse auth servisi için `npx supabase stop` ve `npx supabase start` gerekir (veri korunur).

## Marka logosu depolama
- Bucket `brand-logos` (migration `20261004001200_brand_logo_storage.sql`): herkese açık okunur, yalnız PNG/JPEG/WebP, en fazla 512 KB. SVG bilerek yok (XSS).
- Yazma/silme/listeleme yalnız yönetici ve yalnız kendi kiracısının `<tenant_id>/` önekinde (storage.objects politikaları). Sunucu action'ı (`brand-logo-actions.ts`) ek olarak dosya içeriğini (magic bytes) doğrular, bildirilen türle uyuşmazsa reddeder.
- Canlıda bucket migration ile oluşur; ayrıca Dashboard'da Storage > global dosya boyutu sınırı 512 KB'ın üzerinde olmalıdır (bucket sınırı daha düşüktür ve geçerlidir).
- Giriş sayfası ve kabuk logoyu `<img>` ile doğrudan Supabase kamu adresinden yükler; `next/image` kullanılmadığı için `next.config` uzak alan izni gerekmez.
