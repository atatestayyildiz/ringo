# Canlıya alma rehberi (Supabase Cloud + GitHub + Vercel)

Bu rehberi sırayla uygulayın. Tüm komutlar **Windows PowerShell** içindir ve proje klasöründe (`D:\Telefoncu`) çalıştırılır.

Kurulumun sonunda:
- Veritabanı ve giriş sistemi: **Supabase** (ücretsiz, Frankfurt).
- Kod: **GitHub**'da özel (private) depo.
- Uygulama: **Vercel** (ücretsiz). GitHub'a her gönderimde (push) kendiliğinden yeniden yayınlanır.
- Sabah dağıtımı: Supabase içindeki zamanlayıcı (pg_cron) çalıştırır. Vercel'de ayrı zamanlayıcı yoktur.

> **İlk kurulumda Telegram YOK (karar 2026-10-05).** Bölüm 6 (Vault) ve Bölüm 8 (Telegram) atlanır; Ayarlar'da "Telegram aktif" kapalı kalır. Sabah dağıtımı Telegram'dan bağımsız çalışır. Bölüm 0'da yalnız CRON_SECRET üretin; Vercel'de Telegram değişkenlerini boş bırakın. İleride bildirim istenirse 6 ve 8 uygulanır.

> **Gizli değerler hakkında:** Şifreler ve anahtarlar (service_role, CRON_SECRET, Telegram token) hiçbir dosyaya, nota, sohbete yazılmaz. Yalnız ilgili panele (Supabase, Vercel) yapıştırılır. Bir yere geçici not almanız gerekirse parola yöneticisi kullanın.

Bu gece toplam süre: yaklaşık 1,5 - 2 saat.

---

## 0. Hazırlık: gizli değerleri üretin

İki rastgele değer gerekiyor. Her birini ayrı ayrı üretip parola yöneticisine kaydedin:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

1. Bir kez çalıştırın: çıkan değer **CRON_SECRET**.
2. (Yalnız Telegram açılacaksa) bir kez daha çalıştırın: çıkan değer **TELEGRAM_WEBHOOK_SECRET**.

(İkisi farklı olmalı. Yalnız harf ve rakamdan oluşurlar; Telegram bu biçimi kabul eder.)

---

## 1. Supabase hesabı ve proje

1. https://supabase.com adresinde **Start your project** ile hesap açın (GitHub hesabıyla girmek en kolayı).
2. **New project**:
   - **Name:** `telefoncu`
   - **Database Password:** **Generate a password** ile güçlü bir şifre üretin ve parola yöneticisine kaydedin. (`db push` sırasında sorulacak.)
   - **Region:** **Central EU (Frankfurt)** (`eu-central-1`).
   - Plan: **Free**.
3. Proje hazır olunca (1-2 dakika) şu değerleri bulun:
   - **Project Settings > General > Project ID**: `abcdxyz...` biçiminde. Bu **project-ref**'tir.
   - **Project Settings > API (Data API)** sayfasında **Project URL**: `https://<project-ref>.supabase.co`. Bu **NEXT_PUBLIC_SUPABASE_URL**.
   - **Project Settings > API Keys**:
     - **anon / public** (ya da yeni adıyla **publishable**, `sb_publishable_...`): **NEXT_PUBLIC_SUPABASE_ANON_KEY**.
     - **service_role** (ya da yeni adıyla **secret**, `sb_secret_...`): **SUPABASE_SERVICE_ROLE_KEY**. Bu anahtar her şeye erişir; yalnız Vercel'e ve kurulum betiğine verilir, tarayıcıya asla.
     - Eski adlar "Legacy API keys" sekmesinde durur; ikisinden birini kullanmanız yeterli, aynı türü tutarlı kullanın.

---

## 2. Veritabanını kurun (migration'lar)

```powershell
cd D:\Telefoncu
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

- `login` tarayıcıyı açar, onaylayın.
- `link` veritabanı şifresini sorar (1. adımda kaydettiğiniz).
- `db push` tüm tabloları, kuralları ve zamanlayıcıları (sabah dağıtımı `telefoncu-distribution`, bildirim `telefoncu-notify`) kurar. Onay sorusuna `Y` deyin.
- `db push` sonrası SQL Editor'da RLS kontrolü: `select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r' and not relrowsecurity;` Sonuç **boş** olmalı.
- **Seed (demo verisi) ÇALIŞTIRILMAZ.** `db push`'a `--include-seed` eklemeyin. `npx supabase db reset --linked` komutunu **asla** çalıştırmayın (canlı veriyi siler).

- **Kilit ve PIN:** Çalışan PIN'ini unutursa ya da 5 kez yanlış girerse yönetici **Ayarlar > Ekip > PIN sıfırla** yapar. Yöneticinin kendi PIN'i için ikinci bir yönetici gerekir; yoksa Supabase **SQL Editor**'da: `update public.members set pin_hash = null, locked_at = null, pin_failed = 0 where user_id = (select id from auth.users where email = '<e-posta>');` Not: kilit hesap düzeyindedir; bir cihazda PIN'le açmak aynı kullanıcının diğer cihazlarını da açar.

Kontrol: Supabase panelinde **Table Editor**'da `tenants`, `customers` vb. tablolar görünmeli (boş). **Integrations > Cron** (ya da **Database > Cron Jobs**) altında iki iş görünmeli.

---

## 3. Giriş (Auth) ayarları

Supabase panelinde **Authentication** bölümü:

1. **Sign In / Providers > Email** (ya da **Providers > Email**):
   - **Enable Email provider:** açık.
   - **Confirm email:** açık kalabilir (çalışanları uygulama onaylı oluşturur).
   - **Minimum password length:** `8`.
   - **Secure password change:** açık. (Şifre değiştirirken oturum çok eskiyse çıkış yapıp yeniden girmeniz istenebilir; normaldir.) Bu ayar tek başına yeterli değildir: 24 saatten taze oturum şifreyi yeniden doğrulamadan değiştirebilir. Panel kilidi bu yüzden şifreli girişle açılmaz; yalnız PIN ya da yönetici sıfırlaması açar.
   - **Allow new users to sign up** (Sign In / Providers sayfasının üstünde, "User Signups"): **kapalı**. Hesapları yalnız yönetici açar.
2. **URL Configuration** (bu adımı Vercel adresi belli olduktan sonra, 5. adımın sonunda tamamlayın):
   - **Site URL:** `https://<vercel-adresiniz>` (ör. `https://telefoncu.vercel.app`).
   - **Redirect URLs:** `https://<vercel-adresiniz>/sifre-sifirla/yeni` ekleyin.
3. **Emails > Templates > Reset Password** (ya da **Email Templates > Reset password**):
   - **Subject:** `Şifreni sıfırla`
   - **Body:** proje içindeki `supabase/templates/recovery.html` dosyasını Not Defteri ile açıp tüm içeriği yapıştırın. Bağlantı satırı değişmemeli: `{{ .SiteURL }}/sifre-sifirla/yeni?token_hash={{ .TokenHash }}&type=recovery`.
   - `npx supabase config push` **kullanmayın**: yerel ayar dosyası localhost adreslerini içerir, canlı ayarları bozar.
4. **SMTP** (şifre sıfırlama e-postaları için). Supabase'in kendi e-postası yalnız proje ekibindeki adreslere gönderir ve saatte yalnız birkaç e-posta ile sınırlıdır; mağazada çalışanların şifre sıfırlaması için kendi SMTP'niz gerekir. Bu gece en kolayı **Gmail**:
   - Gmail hesabında **2 Adımlı Doğrulama** açık olmalı.
   - https://myaccount.google.com/apppasswords adresinde "Telefoncu" adıyla bir **uygulama şifresi** oluşturun (16 harf).
   - Supabase: **Authentication > Emails > SMTP Settings > Enable Custom SMTP**:
     - **Sender email:** Gmail adresiniz. **Sender name:** mağaza adı.
     - **Host:** `smtp.gmail.com` **Port:** `465`
     - **Username:** Gmail adresiniz. **Password:** uygulama şifresi (boşluksuz).
   - Alternatif **Resend** (https://resend.com): Host `smtp.resend.com`, Port `465`, Username `resend`, Password = Resend API anahtarı. Alan adınızı doğrulamadan yalnız kendi adresinize gönderir; alan adınız yoksa Gmail'i seçin.
   - SMTP kurulunca **Authentication > Rate Limits** içinde e-posta sınırını saatte 30 civarı bırakın.
   - SMTP'yi bu gece kuramazsanız: uygulama çalışır, yalnız "Şifremi unuttum" e-postaları gitmez. Şifreyi unutan çalışanın şifresini yönetici Supabase panelinden (**Authentication > Users > ... > Send password recovery** ya da kullanıcıyı silip yeniden ekleme) yönetebilir.
5. (**Zorunlu**) **Project Settings > JWT Keys / Auth > JWT expiry:** `900` saniye. İptal edilen ya da pasifleştirilen oturumun jetonu bu süre kadar geçerli kalır; varsayılan 1 saat çok uzundur.

---

## 4. Kodu GitHub'a koyun (özel depo)

1. https://github.com adresinde hesap açın (varsa geçin).
2. Gönderimden önce kontrol (bu bilgisayarda bir kez):
   ```powershell
   cd D:\Telefoncu
   git status
   git check-ignore -v .env.local
   ```
   - `git check-ignore` satırı `.gitignore` içindeki `.env*` kuralını göstermeli (yani `.env.local` depoya girmez). `.env.example` depoda kalır, içinde değer yoktur.
   - `.gitignore` zaten `node_modules/`, `.next/`, `.vercel`, `test-results/`, `playwright-report/`, `e2e/.output/`, `e2e/.report/`, `supabase/.temp/` klasörlerini dışarıda bırakır.
   - `git status` içinde **`logos/`** klasörü görünür: bu sizin klasörünüz (operatör logolarının kaynak dosyaları; uygulamanın kullandığı küçük hâlleri zaten `public/operators/` içinde). Depoya girmesini istemiyorsanız hiçbir şey yapmayın (eklenmediği sürece gitmez). İstiyorsanız `git add logos` ve commit.
   - Yarım kalan değişiklik varsa önce commit edin (`git status` "nothing to commit" demeli).
3. Depoyu oluşturup gönderin. Bu bilgisayarda `gh` (GitHub CLI) kurulu:
   ```powershell
   gh auth login
   gh repo create telefoncu --private --source . --push
   ```
   - `gh auth login`: GitHub.com > HTTPS > Login with a web browser seçin, ekrandaki kodu tarayıcıya girin.
   - `gh` yoksa: GitHub'da **New repository** > ad `telefoncu` > **Private** > README ekleMEden oluşturun, sonra:
     ```powershell
     git remote add origin https://github.com/<kullanici-adiniz>/telefoncu.git
     git push -u origin main
     ```
4. GitHub'da depo sayfasında **Private** etiketini görün.

---

## 5. Vercel: projeyi GitHub'dan içe aktarın

1. https://vercel.com adresinde **Continue with GitHub** ile hesap açın (Hobby, ücretsiz).
2. **Add New... > Project** > GitHub deposu listesinde `telefoncu` > **Import**. (Görünmüyorsa "Adjust GitHub App Permissions" ile Vercel'e bu depoya erişim verin.)
3. **Framework Preset:** Next.js (kendisi seçer). Build/Output ayarlarına dokunmayın.
4. **Environment Variables** bölümüne şunları tek tek ekleyin. **Yalnız Production** ortamını işaretleyin; özellikle `SUPABASE_SERVICE_ROLE_KEY` Preview ve Development'a girmesin (her dal yayını tam yetkiyle çalışmasın):

   | Ad | Değer nereden |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL (1. adım) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon / publishable anahtar |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role / secret anahtar |
   | `TELEGRAM_BOT_TOKEN` | BotFather'dan (8. adım). Şimdi yoksa boş bırakıp sonra ekleyin |
   | `TELEGRAM_WEBHOOK_SECRET` | 0. adımda ürettiğiniz ikinci değer |
   | `CRON_SECRET` | 0. adımda ürettiğiniz ilk değer |
   | `APP_URL` | Vercel adresiniz, sonunda `/` olmadan (ilk yayından sonra öğrenirsiniz, aşağıya bakın) |

5. **Deploy**. 1-3 dakika sürer. Bitince **Visit** ile açılan adres (ör. `https://telefoncu-xxxx.vercel.app`) uygulamanızdır. İsterseniz **Settings > Domains** içinde `telefoncu-magaza.vercel.app` gibi daha kısa bir ad seçin; nihai adres budur.
6. Adres belli olunca:
   - Vercel **Settings > Environment Variables** içinde `APP_URL` = `https://<adres>` (sonda `/` yok).
   - **Deployments** sekmesinde son yayının `...` menüsünden **Redeploy** (env değişikliği yeniden yayın ister).
   - Supabase **Authentication > URL Configuration**'ı tamamlayın (3. adım, madde 2).
7. **Settings > Build and Deployment > Node.js Version:** `24.x`. (Bu bilgisayarda Node 24 kullanılıyor.) Fonksiyon bölgesi `vercel.json` ile Frankfurt'a (`fra1`) sabitlidir; veritabanına yakın olduğu için hızlıdır.

Bundan sonra GitHub'a her `git push` Vercel'de kendiliğinden yeni yayın başlatır.

---

## 6. Zamanlayıcı sırları (Supabase Vault) (İSTEĞE BAĞLI: yalnız Telegram açılınca)

Bildirim zamanlayıcısı uygulamanın adresini ve CRON_SECRET'i Supabase Vault'tan okur. Bunlar tanımlanmazsa zamanlayıcı hiçbir şey yapmaz (zarar vermez, yalnız Telegram bildirimi gitmez).

Supabase panelinde **SQL Editor > New query**, aşağıdakini kendi değerlerinizle doldurup **Run**:

```sql
select vault.create_secret('https://<vercel-adresiniz>', 'app_url');
select vault.create_secret('<CRON_SECRET değeri>', 'cron_secret');
```

- `CRON_SECRET` Vercel'deki ile **birebir aynı** olmalı.
- Sorgu çalıştıktan sonra SQL Editor sekmesindeki metni silin (sorgu geçmişinde kalmasın).
- Değer değiştirmek gerekirse (adres değişti vb.):
  ```sql
  select vault.update_secret((select id from vault.secrets where name = 'app_url'), 'https://<yeni-adres>');
  ```

Kontrol (5-10 dakika sonra):
```sql
select status, return_message, start_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'telefoncu-notify')
order by start_time desc limit 5;

select status_code, left(content, 200) as yanit, created
from net._http_response order by created desc limit 5;
```
`status_code` 200 olmalı. 401 ise CRON_SECRET iki yerde farklıdır; 503 ise Vercel'de `CRON_SECRET` tanımlı değildir.

---

## 7. Mağaza ve ilk yönetici (kurulum betiği)

Bu bilgisayarda, PowerShell'de (anahtarlar yalnız bu pencerede geçerli olur, dosyaya yazılmaz):

```powershell
cd D:\Telefoncu
$env:SUPABASE_URL = Read-Host "Supabase Project URL"
$env:SUPABASE_SERVICE_ROLE_KEY = Read-Host "service_role anahtari"
node scripts/bootstrap.mjs --magaza "Mağaza Adı" --renk "#FF5E2B" --yonetici-eposta sizin@adresiniz.com --yonetici-ad "Adınız Soyadınız"
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
```

- `--renk`: markanın ana rengi, `#RRGGBB` biçiminde.
- Betik ekrana **geçici şifreyi bir kez** yazar. Hemen parola yöneticisine kaydedin; tekrar gösterilmez.
- Veritabanında zaten mağaza varsa ya da e-posta kayıtlıysa durur, ikinci kez kurmaz.
- Yardım: `node scripts/bootstrap.mjs --help`.

İlk giriş:
1. Vercel adresinizi açın, e-posta + geçici şifre ile **Giriş yap**.
2. **PIN belirleme** ekranı açılır: 6 haneli, kolay olmayan bir PIN seçin.
3. **Profil > Şifre** bölümünden geçici şifreyi kendi şifrenizle değiştirin.

---

## 8. Telegram botu (İSTEĞE BAĞLI: ilk kurulumda atlanır)

1. Telegram'da **@BotFather**'ı açın > `/newbot` > bot görünen adı (ör. "Mağaza Bildirim") > kullanıcı adı (sonu `bot` ile biter, ör. `magazaadi_bildirim_bot`).
2. BotFather'ın verdiği **token**'ı Vercel'de `TELEGRAM_BOT_TOKEN` olarak ekleyin, sonra **Redeploy**.
3. Webhook'u kurun (Telegram'a mesajları uygulamaya iletmesini söyler). PowerShell:
   ```powershell
   $token  = Read-Host "Telegram bot token"
   $secret = Read-Host "TELEGRAM_WEBHOOK_SECRET"
   $app    = "https://<vercel-adresiniz>"
   Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$token/setWebhook" -Body @{ url = "$app/api/telegram/webhook"; secret_token = $secret; allowed_updates = '["message"]' }
   Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getWebhookInfo"
   ```
   İlk komut `ok: True` dönmeli. İkincisinde `url` doğru, `last_error_message` boş olmalı.
4. Uygulamada **Ayarlar > Bildirimler**: **Telegram bildirimleri açık** işaretleyin, **Bot kullanıcı adı** alanına `@` olmadan bot kullanıcı adını yazın, kaydedin. Sabah dağıtım ve akşam özet saatlerini buradan ayarlayın.
5. Her çalışan kendi **Profil** sayfasındaki Telegram bölümünden bağlantı kodu alır, bota gönderir; "bağlandı" yanıtı gelir.

---

## 9. Mağaza ayarları

Yönetici olarak, **Ayarlar** sayfasında:
1. **Marka:** logo yükleyin (PNG, JPEG ya da WebP, en çok 512 KB; SVG kabul edilmez). Ad ve renk buradan da değişir.
2. **Ekip:** her çalışan için ad soyad, e-posta, geçici şifre (en az 8 karakter) ve rol (çalışan / yönetici). Geçici şifreyi çalışana yüz yüze verin.
3. **Kurallar:** deneme sayısı, havuz bekleme günü, tur sayısı, dağıtım biçimi (otomatik eşit / serbest havuz / elle).
4. **Müşteriler > İçe aktar:** Meta lead dosyasını (Excel/CSV) yükleyin.

---

## 10. Yarın mağazada kontrol listesi

- [ ] Her telefonda tarayıcıdan uygulama adresini açın (Android: Chrome, iPhone: Safari).
- [ ] **Ana ekrana ekle:** Android Chrome menü > "Ana ekrana ekle"; iPhone Safari paylaş > "Ana Ekrana Ekle".
- [ ] Her çalışan kendi e-postası + geçici şifresiyle girer, **kendi PIN'ini** belirler, **Profil > Şifre** ile şifresini değiştirir.
- [ ] Her çalışan **Profil > Telegram** ile bota bağlanır; bota "bağlandı" mesajı gelir.
- [ ] Yönetici: **Bugün** ekranında dağıtım görünüyor mu? (Otomatik dağıtım ayarlı saatte çalışır; hemen görmek için elle dağıtın.)
- [ ] Bir test araması kaydı girip **Raporlar**'da göründüğünü kontrol edin (sonra gerekirse silin).
- [ ] Ayarlanan özet saatinde Telegram mesajı geldi mi?
- [ ] Bir çalışanla "Şifremi unuttum" deneyin: e-posta gelmeli (SMTP kurulduysa).

---

## 11. İkinci bilgisayar (Victus) kurulumu

Sahada acil düzeltme için. Bir kez yapılır:

1. **Git for Windows:** https://git-scm.com/download/win (varsayılan ayarlarla kurun).
2. **Node.js 24 LTS:** https://nodejs.org (LTS, 24.x). Kontrol: `node -v` `v24...` göstermeli.
3. **GitHub CLI:** https://cli.github.com > kur > `gh auth login`.
4. Depoyu indirin:
   ```powershell
   cd D:\
   gh repo clone <kullanici-adiniz>/telefoncu Telefoncu
   cd D:\Telefoncu
   npm ci
   ```
5. **Claude Code:** PowerShell'de `irm https://claude.ai/install.ps1 | iex`, sonra proje klasöründe `claude` yazıp hesabınızla girin. VS Code kullanıyorsanız "Claude Code" eklentisini kurup `D:\Telefoncu` klasörünü açın.
6. Yerelde çalıştırmak (isteğe bağlı, önerilen):
   - **Docker Desktop** kurun ve açın.
   - `npx supabase start` (ilk sefer birkaç dakika; yerel boş veritabanı + demo verisi kurar).
   - `.env.example` dosyasını `.env.local` adıyla kopyalayın; değerleri `npx supabase status` çıktısındaki yerel adres ve anahtarlarla doldurun.
   - `npm run dev -- -p 3200` > http://localhost:3200 (demo: `yonetici@demo.test`).

> **Uyarı:** Victus'ta `.env.local` içine **canlı** Supabase anahtarlarını koymayın. Yerelde canlı veritabanına bağlanmak, deneme yaparken gerçek müşteri verisini değiştirmek demektir. Docker yoksa yerelde çalıştırmayın; yalnız kodu düzeltip gönderin (12. adım), Vercel yayınlar.

---

## 12. Acil müdahale akışı

1. Hatayı not edin (hangi ekran, ne yapınca). Vercel **Deployments > son yayın > Logs** sunucu hatalarını gösterir.
2. **Önce geri alın, sonra düzeltin:** uygulama tümden bozulduysa Vercel **Deployments**'ta en son çalışan yayının `...` menüsünden **Instant Rollback** (ya da **Promote to Production**). 1 dakikada eski sürüm döner.
3. Düzeltme (Victus ya da bu bilgisayarda, Claude Code ile):
   ```powershell
   cd D:\Telefoncu
   git pull
   # düzeltmeyi yapın
   npm run lint; npm run typecheck; npm test
   git add -A
   git commit -m "Düzeltme: <kısa açıklama>"
   git push
   ```
4. Vercel yeni yayını kendiliğinden başlatır (2-3 dakika). Instant Rollback yaptıysanız yeni yayın bitince **Deployments**'ta onu **Promote to Production** ile canlıya alın.
5. Veritabanı değişikliği (yeni migration) gerekiyorsa: `npx supabase db push` (bu bilgisayar link'li; Victus'ta önce `npx supabase login` ve `npx supabase link --project-ref <project-ref>`). Eski migration dosyalarını değiştirmeyin; `db reset` çalıştırmayın.

---

## 13. Sorun giderme

**Giriş sayfası ile uygulama arasında sürekli yönlendirme (döngü) ya da giriş olmuyor**
- Vercel'de `NEXT_PUBLIC_SUPABASE_URL` ve `NEXT_PUBLIC_SUPABASE_ANON_KEY` doğru mu? Bu ikisi yayın sırasında koda gömülür; değiştirdiyseniz **Redeploy** şart.
- Tarayıcı çerezlerini bu site için temizleyin ya da gizli sekmede deneyin.
- "Hesabın bir mağazaya bağlı değil ya da pasif" uyarısı: hesap var ama mağazaya bağlı değil ya da pasif. Kurulum betiğini çalıştırdınız mı? Çalışan Ayarlar > Ekip'ten mi eklendi?
- Sürekli PIN ekranına dönüyorsa: PIN belirlenmemiş; PIN belirleme ekranını tamamlayın.

**Şifre sıfırlama e-postası gelmiyor**
- Spam klasörüne bakın.
- SMTP kurulu mu (3. adım)? Kurulu değilse Supabase'in kendi e-postası yalnız ekip adreslerine ve saatte birkaç kez gönderir.
- Supabase **Authentication > Logs** (ya da **Logs > Auth**) içinde hata var mı? Gmail'de uygulama şifresi yanlışsa burada görünür.
- E-postadaki bağlantı localhost'a gidiyorsa: **URL Configuration > Site URL** canlı adres olmalı.
- Aynı kişiye 60 saniyeden sık gönderilmez; bekleyip tekrar deneyin.

**Telegram mesajı gelmiyor**
- `getWebhookInfo` (8. adım) çıktısında `last_error_message` var mı? 401 ise `TELEGRAM_WEBHOOK_SECRET` webhook kurulumundakiyle aynı değil; webhook komutunu doğru değerle tekrar çalıştırın.
- Vercel'de `TELEGRAM_BOT_TOKEN` tanımlı ve sonrasında **Redeploy** yapıldı mı?
- Ayarlar > Bildirimler'de "Telegram bildirimleri açık" işaretli ve bot kullanıcı adı doğru mu? Çalışan Profil'den bağlandı mı?
- Zamanlayıcı çalışıyor mu? 6. adımdaki kontrol sorguları. Vault'ta `app_url` ve `cron_secret` yoksa hiç istek gitmez.
- Elle deneme (gönderim yapmaz, yalnız sırada ne olduğunu gösterir):
  ```powershell
  $cs = Read-Host "CRON_SECRET"
  Invoke-RestMethod -Uri "https://<vercel-adresiniz>/api/cron/notify?dry=1" -Headers @{ Authorization = "Bearer $cs" }
  ```

**Supabase projesi duraklatıldı ("paused")**
- Ücretsiz projeler bir hafta hiç kullanılmazsa duraklar. Panelden **Restore project** ile açılır. Her gün kullanıldığı sürece sorun olmaz.
