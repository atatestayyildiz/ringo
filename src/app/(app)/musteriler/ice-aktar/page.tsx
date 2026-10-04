import { Card, EmptyState } from "@/components/ui";

export const metadata = { title: "Excel içe aktar" };

export default async function Page() {
  return (
    <>
      <div className="page-head">
        <h1>Excel içe aktar</h1>
        <p>Müşterileri dosyadan ekle.</p>
      </div>
      <Card>
        <EmptyState title="Bu ekran hazırlanıyor">Bu bölüm sonraki adımda eklenecek.</EmptyState>
      </Card>
    </>
  );
}
