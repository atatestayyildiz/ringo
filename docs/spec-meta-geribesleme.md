# Meta başvuru durum geribeslemesi (Conversions API for CRM)

Amaç: CRM'de bir Meta başvurusunun durumu değişince Meta'ya olay göndermek. Meta, "Dönüşüm adayları" (Conversion Leads)
hedefinde hangi başvurunun işe yaradığını öğrenir ve reklamı ona göre optimize eder.

Kaynak: Meta "Conversions API for CRM" belgeleri (payload specification, implementing the CRM integration).

## Kurallar (Meta tarafı)
- Uç nokta: `POST https://graph.facebook.com/{sürüm}/{DATASET_ID}/events` (sürüm `META_GRAPH_VERSION`).
- Her olay: `event_name` (serbest metin: CRM aşaması), `event_time` (Unix sn), `action_source = "system_generated"`,
  `user_data.lead_id` (15-17 haneli `leadgen_id`), `custom_data.lead_event_source` ("Ringo"), `custom_data.event_source = "crm"`.
- `event_time` gönderimden en fazla 7 gün eski olabilir ve başvuru zamanından sonra olmalı, yoksa olay atılır.
- Her aşama güncellendikçe gönderilir; ham başvuru (ilk aşama) dahil. Son aşamaya gelen başvurunun önceki aşamaları gönderilmiş olmalı.
- Yalnız Facebook/Instagram Instant Form başvuruları desteklenir (bizdeki `meta_leads` kayıtları).
- Hedef aşamanın başvurudan sonraki 28 gün içinde oluşması ve oranının %1-%40 olması önerilir.

## Eşleme (bizdeki sinyal -> Meta aşama adı)
Aşama adları Meta Potansiyel Müşteri Merkezi'ndekilerle aynıdır; reklamcı Reklam Yöneticisi'nde optimize edeceği olayı seçer.

| Bizdeki sinyal | Meta aşaması |
|---|---|
| Başvuru geldi (Meta'dan) | Giriş |
| Randevu verildi, geldi, başvuru, onay (`appointment`, `visited`, `applied`, `approved`) | Uygun |
| İşlem tamam (`completed`) | Dönüşüm |
| İlgilenmiyor, reddedildi, ulaşılamadı (`not_interested`, `rejected`, `unreachable`) | Kayıp |
| Uygun değil, yanlış numara (`disqualified`) | Uygun değil |

Eşleme tek yerde: `src/lib/meta/feedback.ts` (`STAGE_BY_SIGNAL`). Değişirse kod değişir, veritabanı değişmez.
Öneri: optimizasyon olayı olarak "Uygun" (randevu); "Dönüşüm" (satış) çoğu zaman çok seyrektir.

## Tasarım
- Kuyruk tablosu `meta_feedback_events` (tenant_id, leadgen_id, customer_id, signal, event_time, status, attempts, last_error).
  Bir başvuru için aynı sinyal bir kez. RLS açık, politika yok: yalnız service role ve security definer fonksiyonlar.
- Olay üretimi veritabanı tetikleyicilerinde (iş kuralı DB'de):
  - `meta_leads` kaydı `inserted`/`reopened` olunca `lead` sinyali.
  - `customers.call_status` ya da `pipeline_stage` değişince yeni sinyal (müşterinin Meta başvurusu varsa).
  - Geçmiş dönem çalışması (`revive_active`) olan müşterinin olayları gönderilmez.
- Gönderici: mevcut 10 dakikalık `meta-sync` çağrısının sonunda (`flushFeedback`). Ek zamanlayıcı ve ek Vercel fonksiyonu yok.
  - 100'lük toplu istek, olaylar `event_time` sırasıyla.
  - Aynı başvuruya aynı Meta aşaması ikinci kez gönderilmez (ör. randevu sonra geldi: tek "Uygun").
  - 6,5 günü geçen olay `skipped` (süresi doldu). Kalıcı hata (400 geçersiz kimlik) `failed`; geçici hata (429, 5xx, bağlantı) 5 denemeye kadar tekrar.
  - `META_DATASET_ID` tanımlı değilse hiçbir şey gönderilmez; kuyruk birikir (en çok 6,5 gün).
- Ortam: `META_DATASET_ID` (Veri kaynağı/Pixel kimliği), isteğe bağlı `META_TEST_EVENT_CODE` (Etkinlik Yöneticisi > Test Olayları),
  `META_ACCESS_TOKEN` zaten var (sistem kullanıcısına veri kaynağı atanmış ve `ads_management` yetkili olmalı).
- Kişisel veri gönderilmez: yalnız `lead_id` (Meta'nın kendi kimliği), aşama adı ve zaman. E-posta/telefon gönderilmez.

## Kapsam dışı
- Meta panelindeki ayarlar (veri kaynağı, token, reklam seti hedefi) işletme hesabı yöneticisi tarafından yapılır.
- Ayarlar ekranında geri bildirim durumu gösterimi (sonraki iş).
