import Link from "next/link";
import { ImportWizard } from "@/components/musteri/ImportWizard";
import { buttonClass } from "@/components/ui";
import { can, requireAccess } from "@/lib/session";

export const metadata = { title: "Excel içe aktar" };

export default async function Page() {
  await requireAccess(({ member }) => can(member, "import_customers"));
  return (
    <>
      <div className="page-head mu-head">
        <div>
          <h1>Excel içe aktar</h1>
          <p>.xlsx veya .csv dosyasından müşteri ekleyin. Kayıtlı numaralar tekrar eklenmez.</p>
        </div>
        <Link href="/musteriler" className={buttonClass("soft", "sm")}>
          Müşterilere dön
        </Link>
      </div>
      <ImportWizard />
    </>
  );
}
