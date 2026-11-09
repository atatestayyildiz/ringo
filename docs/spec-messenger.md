# Messenger mesajları (TASLAK, kullanıcı onayı bekliyor)

Durum: 2026-11-09 brainstorming yarıda kaldı. Aşağıdaki maddeler Claude'un önerdiği varsayımlardır; kullanıcı henüz onaylamadı. Onaydan önce kod yazılmaz.

## Amaç
Personel Facebook sayfasına (Birey İletişim Bursa) gelen Messenger mesajlarını Ringo panelinde, Messenger'a benzeyen bir ekranda görür ve cevaplar. Kullanıcının isteği: "Messenger'ın kendi arayüzü gibi, mümkünse direkt Facebook'tan çekilsin."

Not: Facebook gelen kutusu başka siteye gömülemez (Business Suite iframe'e izin vermez). Arayüz Ringo'nun kendi ekranı, veri kaynağı Facebook.

Kapsam: yalnız Messenger. Instagram yok.

## Önerilen kararlar (onay bekliyor)
1. **Yetki:** mağazadaki tüm aktif personel görür ve cevaplar (2026-10-12 "tüm aktif kullanıcılar" kararıyla uyumlu). Ayrı `permissions` anahtarı yok. Her giden mesajda yazan personel görünür.
2. **Atama:** yok. Ortak gelen kutusu, okunmamış rozeti.
3. **Müşteriye bağlama:** Messenger telefon vermez. Konuşmada "Müşteri olarak ekle" (ad `participants`'tan, telefon elle) ve "Mevcut müşteriye bağla". Mesaj metninde telefon geçerse öneri olarak gösterilir.
4. **Bildirim:** yeni gelen mesajda web push (`src/lib/push`), tüm aktif personele; Profil'de kişisel aç/kapa.
5. **24 saat penceresi:** konuşma başlığında "Cevap için X sa kaldı"; süre dolunca yazma kutusu kapanır, açıklama metni gösterilir. HUMAN_AGENT etiketi (7 gün) ayrı izin ister, kapsam dışı.
6. **Ekler:** gelen fotoğraf gösterilir; Meta CDN bağlantıları süreli olduğundan gelişte Supabase Storage'a kopyalanır. İlk sürümde giden yalnız metin.
7. **Business Suite:** birlikte kullanılır. Oradan yazılanlar `message_echoes` ile Ringo'ya düşer, "Business Suite" etiketiyle. Okundu durumu eşlenmez.

Teknik karar (Claude'un çağrısı): mesajlar webhook ile anlık gelir ve DB'de saklanır (hızlı ekran, Realtime, Vercel kotası). Kurulumda mevcut konuşmalar bir kez Graph `/{page}/conversations?platform=messenger` ile geri doldurulur.

## Taslak teknik çerçeve (onaydan sonra ayrıntılanacak)
- **Tablolar** (her birinde `tenant_id`, RLS açık, okuma `auth` üyesi kiracısında; yazma yalnız RPC/servis):
  - `messenger_threads`: page_id, psid, ad, customer_id (null olabilir), last_inbound_at, last_message_at, unread.
  - `messenger_messages`: thread_id, mid (benzersiz, idempotent), yön (in/out), kaynak (ringo/business_suite), metin, gönderen üye (out ise), created_at.
  - `messenger_attachments`: message_id, tür, storage_path.
  - Her yeni fonksiyonda `revoke execute ... from public, anon`; gerekeni `grant ... to authenticated`; `_` önekli iç fonksiyonlar authenticated'a kapalı.
- **Webhook:** `src/lib/meta/process.ts` `entry[].messaging` olaylarını da işler (message, message_echoes, imza doğrulaması mevcut). Sayfa aboneliğine `messages`, `message_echoes` alanları eklenir (kullanıcı/Graph).
- **Gönderme:** sunucu action'ı yetki ve 24 saat kontrolünü DB fonksiyonunda yapar, Send API `POST /{page}/messages` (`messaging_type: RESPONSE`) çağırır, sonucu kaydeder; ham Graph/DB hatası Türkçe mesaja çevrilir.
- **Ekran:** `/mesajlar`: solda konuşma listesi, sağda sohbet; mobilde tek sütun. Tasarım dili `tasarim/bugun.html`.
- **Test planı:** pgTAP (RLS, kiracı ayrımı, 24 saat, idempotent mid), Vitest (webhook ayrıştırma, imza, echo), e2e (liste, cevap, müşteriye bağla). Kurgusal ad/telefon.
- **Yayın:** Vercel `META_ACCESS_TOKEN` yeni anahtarla değiştirilir (`pages_messaging` içeren; değer `.env.deploy`'da).

## Açık
- Kullanıcı yukarıdaki 7 maddeyi onaylayacak ya da değiştirecek.
