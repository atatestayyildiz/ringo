import { Card, EmptyState } from "@/components/ui";

export const metadata = { title: "Huni" };

export default async function Page() {
  return (
    <>
      <div className="page-head">
        <h1>Huni</h1>
        <p>Müşterilerin satış aşamaları.</p>
      </div>
      <Card>
        <EmptyState title="Bu ekran hazırlanıyor">Bu bölüm sonraki adımda eklenecek.</EmptyState>
      </Card>
    </>
  );
}
