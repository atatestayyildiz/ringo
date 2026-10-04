import { Card, EmptyState } from "@/components/ui";
import { requireAccess } from "@/lib/session";
export const metadata = { title: "Ayarlar" };

export default async function Page() {
  await requireAccess(({ member }) => member.role === "manager");
  return (
    <>
      <div className="page-head">
        <h1>Ayarlar</h1>
        <p>Kurallar, ekip ve marka.</p>
      </div>
      <Card>
        <EmptyState title="Bu ekran hazırlanıyor">Bu bölüm sonraki adımda eklenecek.</EmptyState>
      </Card>
    </>
  );
}
