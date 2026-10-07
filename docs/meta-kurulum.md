# Meta bağlantısı: kolay kurulum rehberi

Amaç: müşterinin Facebook formunu dolduran herkes birkaç saniye içinde programda "bugün aranacaklar" listesine düşsün.

Kural: **hiçbir şifre ve token sohbete, nota ya da e-postaya yazılmaz.** Hepsi yalnızca Vercel ortam değişkenine girilir.

Menü adları Meta'nın güncel ekranına göre biraz değişebilir. Takılırsanız ekranın görüntüsünü gönderin.

---

## 0. Başlamadan önce (bir kerelik)

- [ ] Facebook hesabınızda **e-posta kayıtlı** ve **iki adımlı doğrulama açık** (Hesap Merkezi > Şifre ve güvenlik).
- [ ] Müşteri sizi **işletme hesabına yönetici olarak ekledi** ve siz daveti kabul ettiniz.
- [ ] business.facebook.com > İşletme Ayarları > Hesaplar > **Sayfalar**: müşterinin sayfası listede görünüyor.
- [ ] Aynı yerde **Reklam hesapları**: form reklamını yayınlayan hesap görünüyor.
- [ ] Müşterinin lead formunda **Ad Soyad** ve **Telefon** soruları var ve formda **gizlilik politikası bağlantısı** var.

---

## 1. Programı hazırlayın (ben yapacağım, siz bekleyin)

Programda şunlar hazır olacak, siz yapmayacaksınız:
- Meta'dan gelen başvuruları alan adres: `https://<müşterinin-alan-adı>/api/meta/webhook`
- Herkese açık bir **gizlilik politikası sayfası**: `https://<müşterinin-alan-adı>/gizlilik` (Meta uygulamasını açarken bu adres istenir)
- Ayarlar'da **Meta bağlantısı** ekranı (bağlantı durumu, son gelen başvuru)

Bunlar yayında olmadan 4. adıma geçmeyin; Meta adresi kaydederken ona istek atar, adres yanıt vermezse kaydetmez.

---

## 2. Geliştirici hesabınız

1. **developers.facebook.com** adresine girin, sağ üstten **Başlayın** (Get Started).
2. Facebook hesabınızla giriş yapın.
3. Telefon numaranızı ve e-postanızı doğrulayın, rolünüz olarak **Geliştirici** seçin, şartları kabul edin.

Ücretsizdir. Bu kayıt bir kere yapılır.

---

## 3. Uygulamayı açın (müşterinin işletme hesabına bağlı)

1. developers.facebook.com > **Uygulamalarım** > **Uygulama oluştur**.
2. Ad: `Ringo Başvuru` (müşterinin marka adını da yazabilirsiniz).
3. İletişim e-postası: kendi e-postanız.
4. Kullanım alanı sorarsa **Diğer** (Other), uygulama türü olarak **İşletme** (Business) seçin.
5. **İşletme hesabı** sorulursa **müşterinin işletmesini** seçin. Bu en önemli adım, uygulama müşterinin hesabında durmalı.
6. Oluştur'a basın.

---

## 4. Uygulamayı ayarlayın

Sol menü **Uygulama ayarları > Temel** (App settings > Basic):

1. **Uygulama Kimliği** (App ID) görünür. Bir kenara not edin (gizli değil).
2. **Uygulama Gizli Anahtarı** (App Secret) > **Göster**. Bunu kopyalayıp **doğrudan Vercel'de** `META_APP_SECRET` olarak kaydedin.
3. **Gizlilik politikası URL'si:** `https://<alan-adı>/gizlilik`
4. **Kullanıcı verisi silme:** talimat metni ya da aynı sayfa adresi.
5. **Kategori:** İş ve sayfalar / Business.
6. Kaydedin.
7. Sayfanın üst çubuğunda **Uygulama modu: Geliştirme** yazan anahtarı **Canlı** (Live) yapın. Canlı olmazsa gerçek başvurular gelmez.

---

## 5. Webhook'u bağlayın

1. Sol menü **Ürün ekle** > **Webhooks** > **Kur**.
2. Açılan listeden **Page** seçin > **Bu nesneye abone ol** (Subscribe to this object).
3. **Callback URL:** `https://<alan-adı>/api/meta/webhook`
4. **Verify token:** kendi uydurduğunuz uzun rastgele bir metin (örnek: 30 harf-rakam). Aynısını Vercel'de `META_VERIFY_TOKEN` olarak kaydedin.
5. **Doğrula ve kaydet**. Yeşil onay çıkmalı.
6. Aynı Page listesinde **leadgen** alanının yanındaki **Abone ol**'a basın.

Doğrulama hata verirse: Vercel'deki `META_VERIFY_TOKEN` ile ekrana yazdığınız metin aynı mı, adres açılıyor mu, bakın.

---

## 6. Sistem kullanıcısı ve süresiz anahtar

business.facebook.com > **İşletme Ayarları**:

1. Kullanıcılar > **Sistem kullanıcıları** > **Ekle**.
2. Ad: `ringo-basvuru`, rol: **Yönetici**.
3. Oluşan kullanıcıyı seçin > **Varlık ekle**:
   - **Sayfalar** > müşterinin sayfası > **Tam kontrol** açık.
   - **Uygulamalar** > Ringo Başvuru > **Tam kontrol** açık.
4. Aynı kullanıcıda **Yeni anahtar oluştur** (Generate new token):
   - Uygulama: Ringo Başvuru
   - Süre: **Hiçbir zaman** (Never)
   - İzinler: `leads_retrieval`, `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `ads_management`
5. Anahtarı **bir kez gösterir**. Kopyalayıp doğrudan Vercel'de `META_ACCESS_TOKEN` olarak kaydedin. Kaybederseniz yenisini üretin.

---

## 7. Başvuru erişimini açın (sık atlanan adım)

İşletme Ayarları > **Entegrasyonlar > Başvuru erişimi** (Leads Access):

1. **Sayfalar** > müşterinin sayfasını seçin.
2. **CRM'ler** sekmesi > **CRM ata** > **Ringo Başvuru** uygulamasını ekleyin.

Bu yapılmazsa Meta başvuruyu bildirir ama içeriğini vermez.

---

## 8. Vercel ayarları

Vercel > projeniz > **Settings > Environment Variables** (Production):

| Ad | Değer |
|---|---|
| `META_APP_SECRET` | 4. adımdaki App Secret |
| `META_VERIFY_TOKEN` | 5. adımda uydurduğunuz metin |
| `META_ACCESS_TOKEN` | 6. adımdaki süresiz anahtar |
| `META_PAGE_ID` | Sayfa numarası: sayfa > Hakkında > Sayfa kimliği |

Kaydedip **Deployments > en son yayın > Redeploy** yapın. Değişken eklemek yeniden yayın ister.

---

## 9. Bağlantıyı kurun

1. Programa yönetici olarak girin > **Ayarlar > Meta bağlantısı**.
2. **Bağlantıyı kur** düğmesine basın: program sayfayı uygulamaya abone eder.
3. Durum **Bağlı** olmalı.

---

## 10. Deneme

1. **developers.facebook.com/tools/lead-ads-testing** adresine girin.
2. Sayfayı ve formu seçin > **Önizleme oluştur** > **Başvuru oluştur** (Create lead).
3. Programda **Müşteriler** sayfasında yeni kaydı arayın. 10-60 saniye içinde görünmeli.
4. Görünmüyorsa: Ayarlar > Meta bağlantısı > **Son hata**'ya bakın.
5. Sonra bir **gerçek başvuru** bekleyin (ya da müşteriye kendi formunu doldurtun). Gerçek başvuru da düşüyorsa tamamdır.

---

## 11. Bitirirken

- [ ] Müşteriye "bağlandı, başvurular artık otomatik düşüyor" deyin.
- [ ] Bir gün boyunca günde bir kez Ayarlar > Meta bağlantısı'na bakın (son başvuru zamanı yeni mi).
- [ ] İsterseniz işiniz bitince müşteri sizi işletme hesabından çıkarabilir (Kişiler > adınız > Kaldır). Sistem kullanıcısı ve uygulama müşteride kalır, bağlantı çalışmaya devam eder.

---

## Sık karşılaşılan sorunlar

| Belirti | Sebep ve çözüm |
|---|---|
| Webhook kaydedilmiyor | Adres açılmıyor ya da `META_VERIFY_TOKEN` farklı. Adresi tarayıcıda açıp deneyin, Vercel'de redeploy yaptığınızdan emin olun. |
| Test başvurusu düşmüyor ama Meta "gönderildi" diyor | 7. adım atlanmış (Başvuru erişimi) ya da `META_ACCESS_TOKEN` yanlış. |
| Gerçek başvuru gelmiyor, test geliyor | Uygulama **Canlı** modda değil (4. adım, madde 7). |
| Sayfa listede yok | Sayfa işletme hesabına bağlı değil. Müşteri Hesaplar > Sayfalar > Ekle ile eklemeli. |
| Aynı kişi iki kez geldi | Sorun değil, program tek kayıt tutar. |
| Telefon boş geldi | Formda telefon sorusu yok ya da farklı adlı. Formun soru adını bana iletin. |

Bu rehberin 1. ve 9. adımları kod yazılınca çalışır. 2-8. adımları kod hazır olmadan da yapabilirsiniz, ama **5. adımda adres yayında olmalı**; ondan önce kendi hesabınızı, uygulamayı ve sistem kullanıcısını hazırlayın.
