import { IconPool } from "@/components/icons";
import "@/components/musteri/musteri.css";
import { CUSTOMER_COLUMNS, memberName, type Customer, type MemberLite } from "@/components/musteri/shared";
import { Avatar, Card, Chip, EmptyState } from "@/components/ui";
import { dayDiff, formatDayMonth, formatPhone } from "@/lib/format";
import { getSessionContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Havuz" };

function returnText(iso: string): { main: string; sub: string } {
  const diff = dayDiff(iso);
  const date = formatDayMonth(iso);
  if (diff < 0) return { main: "Süresi doldu", sub: "Sonraki dağıtımda listeye çıkar" };
  if (diff === 0) return { main: "Bugün", sub: `${date}, sonraki dağıtımda listeye çıkar` };
  if (diff === 1) return { main: "Yarın", sub: date };
  return { main: `${diff} gün sonra`, sub: date };
}

export default async function Page() {
  const { settings } = await getSessionContext();
  const supabase = await createClient();

  const [{ data, error }, { data: memberRows }] = await Promise.all([
    supabase
      .from("customers")
      .select(CUSTOMER_COLUMNS)
      .eq("call_status", "pool")
      .order("next_call_at", { ascending: true })
      .order("id")
      .limit(300),
    supabase.from("members").select("id, full_name, is_active"),
  ]);
  const rows = (data ?? []) as Customer[];
  const members = (memberRows ?? []) as MemberLite[];

  return (
    <div className="view-pool">
      <div className="page-head">
        <h1>Havuz</h1>
        <p>
          {settings.max_attempts} başarısız denemeden sonra havuza düşen müşteriler, {settings.pool_wait_days} gün sonra
          listeye geri çıkar.
        </p>
      </div>
      <Card>
        <h2>
          Havuzdakiler
          <Chip>{rows.length} müşteri</Chip>
        </h2>
        {error ? (
          <div className="form-error" role="alert">
            Havuz yüklenemedi. Sayfayı yenileyin; sorun sürerse yöneticinize bildirin.
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="Havuz boş" icon={<IconPool />}>
            Üst üste ulaşılamayan müşteriler burada bekler, süresi dolunca tekrar arama listesine döner.
          </EmptyState>
        ) : (
          <ul className="mu-list">
            {rows.map((c) => {
              const r = c.next_call_at ? returnText(c.next_call_at) : { main: "-", sub: "" };
              const who = memberName(members, c.assigned_to);
              return (
                <li key={c.id}>
                  <div className="mu-pool-row">
                    <span className="mu-who">
                      <Avatar name={c.full_name} />
                      <span style={{ minWidth: 0 }}>
                        <b>{c.full_name}</b>
                        <span>
                          {formatPhone(c.phone)}
                          {who ? `, ${who}` : ""}
                        </span>
                      </span>
                    </span>
                    <span className="mu-days">
                      <b>{r.main}</b>
                      <span>{r.sub}</span>
                    </span>
                    <span className="mu-cell" title="Havuza düşme sayısı">
                      <Chip>
                        Havuz {c.pool_count} / {settings.max_rounds}
                      </Chip>
                    </span>
                    <span className="mu-note">{c.last_note ?? ""}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
