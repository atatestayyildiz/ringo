import { Card, EmptyState } from "@/components/ui";

export const metadata = { title: "Müşteriler" };

export default async function Page() {
  return (
    <>
      <div className="page-head">
        <h1>Müşteriler</h1>
        <p>Müşteri listesi ve arama.</p>
      </div>
      <Card>
        <EmptyState title="Bu ekran hazırlanıyor">Bu bölüm sonraki adımda eklenecek.</EmptyState>
      </Card>
    </>
  );
}
