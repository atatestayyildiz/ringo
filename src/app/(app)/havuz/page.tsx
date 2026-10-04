import { Card, EmptyState } from "@/components/ui";

export const metadata = { title: "Havuz" };

export default async function Page() {
  return (
    <>
      <div className="page-head">
        <h1>Havuz</h1>
        <p>Bir süre sonra listeye dönecek müşteriler.</p>
      </div>
      <Card>
        <EmptyState title="Bu ekran hazırlanıyor">Bu bölüm sonraki adımda eklenecek.</EmptyState>
      </Card>
    </>
  );
}
