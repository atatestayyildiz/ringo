import { FunnelBoard } from "@/components/musteri/FunnelBoard";
import { CUSTOMER_COLUMNS, MAIN_STAGES, type Customer, type MemberLite, type Viewer } from "@/components/musteri/shared";
import { getSessionContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Huni" };

export default async function Page() {
  const { member } = await getSessionContext();
  const supabase = await createClient();

  const [{ data, error }, { data: events }, { data: memberRows }] = await Promise.all([
    supabase
      .from("customers")
      .select(CUSTOMER_COLUMNS)
      .not("pipeline_stage", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1000),
    supabase.from("pipeline_events").select("customer_id, stage").limit(5000),
    supabase.from("members").select("id, full_name, is_active"),
  ]);

  const customers = (data ?? []) as Customer[];

  // Her müşteri için ulaştığı en ileri ana aşama (olaylar + mevcut aşama)
  const order = new Map<string, number>(MAIN_STAGES.map((s, i) => [s, i]));
  const furthest = new Map<string, number>();
  const bump = (id: string, stage: string | null) => {
    const i = stage ? order.get(stage) : undefined;
    if (i === undefined) return;
    if ((furthest.get(id) ?? -1) < i) furthest.set(id, i);
  };
  for (const e of events ?? []) bump(e.customer_id, e.stage);
  for (const c of customers) bump(c.id, c.pipeline_stage);
  const reached = MAIN_STAGES.map((_, i) => {
    let n = 0;
    for (const v of furthest.values()) if (v >= i) n++;
    return n;
  });

  const viewer: Pick<Viewer, "id" | "isManager"> = { id: member.id, isManager: member.role === "manager" };

  return (
    <>
      <div className="page-head">
        <h1>Huni</h1>
        <p>Randevudan işlem tamamlanana kadar müşterilerin aşamaları.</p>
      </div>
      {error ? (
        <div className="form-error" role="alert">
          Huni yüklenemedi. Sayfayı yenileyin; sorun sürerse yöneticinize bildirin.
        </div>
      ) : (
        <FunnelBoard customers={customers} members={(memberRows ?? []) as MemberLite[]} viewer={viewer} reached={reached} />
      )}
    </>
  );
}
