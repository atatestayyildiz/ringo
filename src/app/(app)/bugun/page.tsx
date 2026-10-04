import { Card, EmptyState } from "@/components/ui";

export const metadata = { title: "Bugün" };

export default async function Page() {
  return (
    <>
      <div className="page-head">
        <h1>Bugün</h1>
        <p>Günün arama listesi.</p>
      </div>
      <Card>
        <EmptyState title="Bu ekran hazırlanıyor">Bu bölüm sonraki adımda eklenecek.</EmptyState>
      </Card>
    </>
  );
}
