import { IconPool } from "@/components/icons";
import "@/components/musteri/musteri.css";
import { PoolList, type PoolRow } from "@/components/havuz/PoolList";
import { Card, EmptyState } from "@/components/ui";
import { getSessionContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Havuz" };

/** Ortak havuz: tüm aktif üyeler görür (list_pool, telefon yok) ve "Kendime al" ile listesine alır. */
export default async function Page() {
  const { settings } = await getSessionContext();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("list_pool").limit(300);
  const rows = (data ?? []) as PoolRow[];
  // Serbest havuzda havuz yalnız görüntülenir (take_from_pool DB'de kapalı)
  const canTake = settings.distribution_mode !== "free_pool";

  return (
    <div className="view-pool">
      <div className="page-head">
        <h1>Havuz</h1>
        <p>
          {settings.max_attempts} başarısız denemeden sonra havuza düşen müşteriler, {settings.pool_wait_days} gün sonra
          listeye geri çıkar.{canTake ? " Beklemeden aramak istediğini kendi listene alabilirsin." : ""}
        </p>
        {canTake ? null : (
          <p className="hv-mode-note" data-testid="pool-mode-note">
            Havuzdan dönen müşteriler Sıradakini al kuyruğuna girer.
          </p>
        )}
      </div>
      <Card>
        <h2>Havuzdakiler</h2>
        {error ? (
          <div className="form-error" role="alert">
            Havuz yüklenemedi. Sayfayı yenileyin; sorun sürerse yöneticinize bildirin.
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="Havuz boş" icon={<IconPool />}>
            Üst üste ulaşılamayan müşteriler burada bekler, süresi dolunca tekrar arama listesine döner.
          </EmptyState>
        ) : (
          <PoolList rows={rows} maxRounds={settings.max_rounds} canTake={canTake} />
        )}
      </Card>
    </div>
  );
}
