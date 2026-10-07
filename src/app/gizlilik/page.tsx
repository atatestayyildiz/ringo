export const metadata = { title: "Gizlilik ve veri silme" };
export const dynamic = "force-dynamic";

/** Herkese açık sade metin. İşletme adı ve iletişim ortamdan okunur (BUSINESS_NAME, BUSINESS_CONTACT). */
export default function Page() {
  const name = process.env.BUSINESS_NAME?.trim() || "bu işletme";
  const contact = process.env.BUSINESS_CONTACT?.trim();
  const box = { maxWidth: 680, margin: "0 auto", padding: "40px 20px 64px", color: "var(--ink)", lineHeight: 1.6 } as const;
  const h2 = { fontSize: 18, fontWeight: 700, margin: "28px 0 8px" } as const;
  return (
    <main style={box}>
      <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>Gizlilik ve veri silme</h1>
      <p style={{ color: "var(--ink-2)" }}>Bu sayfa, {name} tarafından Facebook ve Instagram başvuru formları üzerinden toplanan bilgilerin nasıl kullanıldığını anlatır.</p>

      <h2 style={h2}>Hangi bilgiler toplanır</h2>
      <p>Başvuru formunda sizin verdiğiniz ad ve telefon numarası ile forma eklenmiş diğer sorulara verdiğiniz cevaplar.</p>

      <h2 style={h2}>Ne için kullanılır</h2>
      <p>Başvurunuza dönüş yapmak, sizi aramak ve istediğiniz konuda bilgilendirmek için. Başka bir amaçla kullanılmaz.</p>

      <h2 style={h2}>Paylaşım</h2>
      <p>Bilgileriniz, hizmeti sunmak için kullanılan teknik sağlayıcılar (barındırma, veritabanı, bildirim altyapısı) dışında üçüncü kişilerle paylaşılmaz.</p>

      <h2 style={h2}>Saklama ve silme</h2>
      <p>
        Bilgilerinizin silinmesini ya da düzeltilmesini istediğinizde {name} ile iletişime geçin
        {contact ? <>: {contact}</> : "."} Yasal saklama yükümlülükleri saklı kalmak üzere talebiniz üzerine kaydınız silinir ya da düzeltilir.
      </p>
    </main>
  );
}
