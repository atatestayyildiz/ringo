import Link from "next/link";
import { ArchiveFilters } from "@/components/musteri/ArchiveFilters";
import { ArchiveList } from "@/components/musteri/ArchiveList";
import { ARCHIVE_CLAIM_MAX, normalizeArchive } from "@/components/musteri/shared";
import { buttonClass, Card } from "@/components/ui";
import { getSessionContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Geçmiş dönem" };

const PAGE_SIZE = 20;
const SORTS: Record<string, string> = { eski: "oldest", ad: "name" };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Geçmiş dönem müşterileri: kapanmış (uygun değil, ulaşılamadı, ilgilenmiyor) müşteriler filtrelenir, çalışan
 * seçip kendine atar. Herkes görür. Bu aramalar bugünkü form müşterisi sayılmaz (ayrı rapor).
 */
export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  await getSessionContext();
  const supabase = await createClient();

  const q = one(sp.q).trim();
  const sonuc = one(sp.sonuc);
  const operator = one(sp.operator);
  const bas = DATE.test(one(sp.bas)) ? one(sp.bas) : "";
  const bit = DATE.test(one(sp.bit)) ? one(sp.bit) : "";
  const sira = SORTS[one(sp.sira)] ?? "recent";
  const page = Math.max(1, Number.parseInt(one(sp.sayfa), 10) || 1);

  const { data, error } = await supabase.rpc("archive_list", {
    p_q: q || undefined,
    p_outcome: sonuc || undefined,
    p_operator: operator || undefined,
    p_from: bas || undefined,
    p_to: bit || undefined,
    p_sort: sira,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });
  const { total, rows } = normalizeArchive(data);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(q || sonuc || operator || bas || bit);

  const hrefFor = (p: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, sonuc, operator, bas, bit, sira: one(sp.sira) })) if (v) u.set(k, v);
    if (p > 1) u.set("sayfa", String(p));
    const s = u.toString();
    return s ? `/musteriler/gecmis?${s}` : "/musteriler/gecmis";
  };

  return (
    <>
      <div className="page-head mu-head">
        <div>
          <h1>Geçmiş dönem</h1>
          <p>
            Kapanmış müşterileri filtrele, seç ve kendine ata. En fazla {ARCHIVE_CLAIM_MAX} müşteri bekleyebilir. Bu aramalar bugünkü
            form müşterisi sayılmaz, ayrı raporlanır; arama sayaçlarına eklenir.
          </p>
        </div>
        <Link href="/musteriler" className={buttonClass("soft")}>
          Müşteriler
        </Link>
      </div>

      <ArchiveFilters />

      {error ? (
        <Card>
          <div className="form-error" role="alert">
            Liste yüklenemedi. Sayfayı yenileyin; sorun sürerse yöneticinize bildirin.
          </div>
        </Card>
      ) : (
        <>
          <p className="ar-count">
            {total.toLocaleString("tr-TR")} müşteri{filtered ? " (filtreye uyan)" : ""}
          </p>
          <Card>
            <ArchiveList rows={rows} filtered={filtered} />
          </Card>
        </>
      )}

      {total > PAGE_SIZE ? (
        <nav className="mu-pager" aria-label="Sayfalama">
          <Link href={hrefFor(page - 1)} className={buttonClass("soft", "sm")} aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : undefined}>
            Önceki
          </Link>
          <span>
            Sayfa {page} / {pageCount}
          </span>
          <Link href={hrefFor(page + 1)} className={buttonClass("soft", "sm")} aria-disabled={page >= pageCount} tabIndex={page >= pageCount ? -1 : undefined}>
            Sonraki
          </Link>
        </nav>
      ) : null}
    </>
  );
}
