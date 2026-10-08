# Meta başvuru durum geribeslemesi: devam notu (2026-10-08)

Durum: planlandı, kod yok. Başka bilgisayardan devam etmek için yazıldı.

## Ne isteniyor
Reklamcı "başvuru durum geribeslemesini ayarlasın" dedi. Anlamı: CRM'de müşteri durumu değişince Meta'ya olay göndermek (Conversions API for CRM / Conversion Leads). Meta algoritması hangi başvurunun gerçekten işe yaradığını öğrenir ve reklamı ona göre optimize eder.

## Elimizde olan
- `meta_leads` tablosu: `leadgen_id` ve `customer_id` bağlı (migration `20261007000300_meta_leads.sql`).
- `customers.call_status`: pending, retry, pool, done, unreachable, disqualified.
- `.env`'de `META_ACCESS_TOKEN`, `META_PAGE_ID` var. Meta kodu `src/lib/meta/`.

## Eksik olan
Durum değişince Meta'ya olay gönderen DB olay kuyruğu (migration) + sunucu göndericisi + testler. Orta boy iş, tek şerit.

## Önerilen eşleme (reklamcıyla netleşecek)
| Bizdeki durum | Meta olayı |
|---|---|
| done | dönüşüm / satış |
| disqualified | nitelikli değil |
| unreachable | nitelikli değil |
| diğerleri | gönderilmez |

## Kullanıcıdan beklenen 3 bilgi
1. Etkinlik Yöneticisi > Veri kaynakları: CRM dataset veya Pixel ID. Yoksa Müşteri Adayı/CRM kaynağı oluşturulacak.
2. Reklam Yöneticisi > reklam seti > Performans hedefi: "Dönüşüm adayları" seçeneği var mı, seçili olay adı ne.
3. İşletme Ayarları > Sistem kullanıcıları: `ringo-basvuru` kullanıcısına dataset atanmış mı, `ads_management` yetkisi var mı.

## Kurallar
- Kullanıcı işletme hesabı yöneticisi; Meta panelindeki işlemleri (token üretimi dahil) kendisi yapar, Claude yapmaz.
- Token değerleri sohbete yazılmaz, yalnız `.env`'ye girer; anahtar adı `.env.example`'a eklenir.
- Bilgiler gelince önce `docs/spec-meta-geribesleme.md` yazılır, sonra uygulanır.

## Yeni oturuma verilecek komut
> docs/devam-meta-geribesleme.md dosyasını oku, kaldığımız yerden devam edelim.
