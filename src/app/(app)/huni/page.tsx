import { FunnelBoard } from "@/components/musteri/FunnelBoard";
import { FunnelDateBar } from "@/components/musteri/FunnelDateBar";
import { dayKey } from "@/lib/format";
import { CUSTOMER_COLUMNS, MAIN_STAGES, type Customer, type MemberLite } from "@/components/musteri/shared";
import { getSessionContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Huni" };

export default async function Page({ searchParams }: { searchParams: Promise<{ gun?: string }> }) {
  const { gun } = await searchParams;
  await getSessionContext();
  const supabase = await createClient();
  const today = dayKey(new Date());
  // Randevu gününe göre süzme; randevu günü aşama ilerleyince de korunur
  const day = typeof gun === "string" && /^\d{4}-\d{2}-\d{2}$/.test(gun) ? gun : null;

  let query = supabase.from("customers").select(CUSTOMER_COLUMNS).not("pipeline_stage", "is", null);
  if (day) query = query.eq("appointment_day", day);

  const [{ data, error }, { data: events }, { data: memberRows }] = await Promise.all([
    query.order("updated_at", { ascending: false }).limit(1000),
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
  const shown = new Set(customers.map((c) => c.id));
  for (const e of events ?? []) if (shown.has(e.customer_id)) bump(e.customer_id, e.stage);
  for (const c of customers) bump(c.id, c.pipeline_stage);
  const reached = MAIN_STAGES.map((_, i) => {
    let n = 0;
    for (const v of furthest.values()) if (v >= i) n++;
    return n;
  });


  return (
    <div className="view-huni">
      <div className="page-head">
        <h1>Huni</h1>
        <p>Randevudan işlem tamamlanana kadar müşterilerin aşamaları.</p>
        <FunnelDateBar day={day} today={today} />
      </div>
      {error ? (
        <div className="form-error" role="alert">
          Huni yüklenemedi. Sayfayı yenileyin; sorun sürerse yöneticinize bildirin.
        </div>
      ) : (
        <FunnelBoard customers={customers} members={(memberRows ?? []) as MemberLite[]} reached={reached} day={day} />
      )}
    </div>
  );
}
