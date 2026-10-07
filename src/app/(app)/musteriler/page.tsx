import Link from "next/link";
import { CustomerFilters } from "@/components/musteri/CustomerFilters";
import { CustomerList } from "@/components/musteri/CustomerList";
import { CustomerActions } from "@/components/musteri/CustomerActions";
import { ListSummary } from "@/components/musteri/ListSummary";
import { CUSTOMER_COLUMNS, type Customer, type MemberLite, type Viewer } from "@/components/musteri/shared";
import { buttonClass, Card } from "@/components/ui";
import { can, getSessionContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Müşteriler" };

const PAGE_SIZES = [20, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 20;

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** PostgREST or() filtresini bozan karakterleri ve ilike joker karakterlerini temizler. */
function cleanTerm(s: string): string {
  return s.replace(/[,()\\"%*_:]/g, " ").replace(/\s+/g, " ").trim();
}

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { member } = await getSessionContext();
  const supabase = await createClient();

  const q = cleanTerm(one(sp.q));
  const durum = one(sp.durum);
  const asama = one(sp.asama);
  const operator = one(sp.operator);
  const atanan = one(sp.atanan);
  const page = Math.max(1, Number.parseInt(one(sp.sayfa), 10) || 1);
  const adet = Number.parseInt(one(sp.adet), 10);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(adet) ? adet : DEFAULT_PAGE_SIZE;

  let query = supabase.from("customers").select(CUSTOMER_COLUMNS, { count: "exact" });

  if (q) {
    let digits = q.replace(/\D/g, "");
    if (digits.startsWith("90") && digits.length >= 6) digits = digits.slice(2);
    const hasLetters = /[\p{L}]/u.test(q);
    const parts: string[] = [];
    if (hasLetters || digits.length < 3) parts.push(`full_name.ilike.%${q}%`);
    if (digits.length >= 3 && !hasLetters) {
      parts.push(`phone.ilike.%${digits}%`, `phone_alt.ilike.%${digits}%`);
    } else if (digits.length >= 3) {
      parts.push(`phone.ilike.%${digits}%`);
    }
    query = query.or(parts.join(","));
  }
  if (durum) query = query.eq("call_status", durum);
  if (asama === "yok") query = query.is("pipeline_stage", null);
  else if (asama) query = query.eq("pipeline_stage", asama);
  if (operator === "yok") query = query.is("operator", null);
  else if (operator) query = query.eq("operator", operator);
  if (atanan === "yok") query = query.is("assigned_to", null);
  else if (atanan) query = query.eq("assigned_to", atanan);

  const filtered = Boolean(q || durum || asama || operator || atanan);
  const from = (page - 1) * pageSize;
  const [{ data, count, error }, { data: memberRows }, allCount] = await Promise.all([
    query.order("created_at", { ascending: false }).order("id").range(from, from + pageSize - 1),
    supabase.from("members").select("id, full_name, is_active").order("full_name"),
    // Filtresiz toplam: filtre yoksa ana sorgunun sayısı zaten odur
    filtered
      ? supabase.from("customers").select("id", { count: "exact", head: true })
      : Promise.resolve({ count: null as number | null }),
  ]);

  const rows = (data ?? []) as Customer[];
  const members = (memberRows ?? []) as MemberLite[];
  const total = count ?? 0;
  const allTotal = filtered ? (allCount.count ?? total) : total;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const viewer: Viewer = {
    id: member.id,
    isManager: member.role === "manager",
    canImport: can(member, "import_customers"),
    canReassign: can(member, "reassign"),
    canDelete: can(member, "delete_customers"),
  };

  const hrefFor = (p: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: one(sp.q), durum, asama, operator, atanan })) if (v) u.set(k, v);
    if (pageSize !== DEFAULT_PAGE_SIZE) u.set("adet", String(pageSize));
    if (p > 1) u.set("sayfa", String(p));
    const s = u.toString();
    return s ? `/musteriler?${s}` : "/musteriler";
  };

  const canExport = can(member, "export");
  const exportParams = new URLSearchParams();
  for (const [k, v] of Object.entries({ q: one(sp.q), durum, asama, operator, atanan })) if (v) exportParams.set(k, v);
  const exportHref = `/api/export/customers${exportParams.size ? `?${exportParams}` : ""}`;

  return (
    <>
      <div className="page-head mu-head">
        <div>
          <h1>Müşteriler</h1>
          <p>
            {viewer.isManager || can(member, "view_all_customers")
              ? "Tüm müşteriler, arama ve filtrelerle."
              : "Bugün sana atanan müşteriler."}
          </p>
        </div>
        <CustomerActions canImport={viewer.canImport} exportHref={canExport ? exportHref : null} />
      </div>

      <CustomerFilters members={members} />

      {error ? null : (
        <ListSummary
          total={total}
          allTotal={allTotal}
          from={from}
          shown={rows.length}
          filtered={filtered}
          pageSize={pageSize}
          pageSizes={[...PAGE_SIZES]}
          canDeleteAll={viewer.isManager}
        />
      )}

      <Card>
        {error ? (
          <div className="form-error" role="alert">
            Müşteriler yüklenemedi. Sayfayı yenileyin; sorun sürerse yöneticinize bildirin.
          </div>
        ) : (
          <CustomerList rows={rows} members={members} viewer={viewer} filtered={filtered} total={total} />
        )}
      </Card>

      {total > pageSize ? (
        <nav className="mu-pager" aria-label="Sayfalama">
          <Link
            href={hrefFor(page - 1)}
            className={buttonClass("soft", "sm")}
            aria-disabled={page <= 1}
            tabIndex={page <= 1 ? -1 : undefined}
          >
            Önceki
          </Link>
          <span>
            Sayfa {page} / {pageCount}
          </span>
          <Link
            href={hrefFor(page + 1)}
            className={buttonClass("soft", "sm")}
            aria-disabled={page >= pageCount}
            tabIndex={page >= pageCount ? -1 : undefined}
          >
            Sonraki
          </Link>
        </nav>
      ) : null}
    </>
  );
}
