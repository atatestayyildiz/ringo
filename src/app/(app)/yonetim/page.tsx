import { Card, EmptyState } from "@/components/ui";
import { can, requireAccess } from "@/lib/session";
export const metadata = { title: "Yönetim" };

export default async function Page() {
  await requireAccess(({ member }) => member.role === "manager" || can(member, "view_reports"));
  return (
    <>
      <div className="page-head">
        <h1>Yönetim</h1>
        <p>Ekip ve günün özeti.</p>
      </div>
      <Card>
        <EmptyState title="Bu ekran hazırlanıyor">Bu bölüm sonraki adımda eklenecek.</EmptyState>
      </Card>
    </>
  );
}
