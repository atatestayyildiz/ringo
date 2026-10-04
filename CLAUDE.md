# Telefoncu CRM

White label müşteri takip sistemi (telefon mağazası, Meta lead arama akışı). Spec: `docs/spec-faz1.md`. Bu dosyadaki isimler sözleşmedir; değiştirme, Şef'e bildir.

## Yığın
Next.js App Router + TypeScript strict + Tailwind v4 + Supabase (`@supabase/ssr`). Yerel DB: `npx supabase start` (Docker). Testler: `npx supabase test db` (pgTAP), `npm test` (Vitest), `npm run e2e` (Playwright).

## Kurallar
- İş kuralı (deneme sayacı, havuz, dağıtım, yetki) yalnız veritabanı fonksiyonlarında. Arayüz RPC çağırır, kuralı tekrar yazmaz.
- Her tabloda `tenant_id`; RLS kapalı tablo olmaz. Service role anahtarı yalnız sunucuda.
- Her yeni DB fonksiyonunda açık `revoke execute ... from public, anon` + gerekiyorsa `grant ... to authenticated`; iç (`_` önekli) fonksiyonlar authenticated'a kapalı. Eski migration'lar değiştirilmez, yeni migration yazılır; DB sıfırlanmaz (`migration up`).
- Sunucu action'ları ham DB hata metnini kullanıcıya göstermez; Türkçe mesaja çevirir.
- Marka adı/rengi/logosu kodda sabit yazılmaz; `tenant_settings`'ten gelir (`--brand`).
- Tasarım kaynağı: `tasarim/bugun.html` (token, hap dili, gün şeridi, taramalı doku, açık/koyu tema).
- UI metni Türkçe, sade. Kullanıcıya görünen metinde em dash (—) yok.
- Gerçek kişi verisi (isim, telefon) seed'e, teste, ekrana girmez; kurgusal veri kullan.
- `.env*` okunmaz; anahtar adları `.env.example`'da.
- `referans tasarımlar/` kullanıcının klasörü; dokunma.
