"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markAbsentAction } from "@/app/(app)/yonetim/actions";
import { Avatar, Button, Chip, EmptyState, Modal, useToast } from "@/components/ui";
import s from "./yonetim.module.css";

export type TeamRow = {
  member_id: string;
  full_name: string;
  assigned: number;
  done: number;
  reached: number;
  appointments: number;
  retries: number;
  absent: boolean;
};

export function TeamList({ rows, day, canMarkAbsent }: { rows: TeamRow[]; day: string; canMarkAbsent: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [target, setTarget] = useState<TeamRow | null>(null);
  const [pending, start] = useTransition();

  if (rows.length === 0) {
    return (
      <EmptyState title="Ekipte kimse yok">
        Ayarlar, Ekip bölümünden çalışan ekleyin. Dağıtım yapılınca burada ilerlemeleri görünür.
      </EmptyState>
    );
  }

  const confirm = () => {
    if (!target) return;
    const t = target;
    start(async () => {
      const res = await markAbsentAction(t.member_id, day);
      if (res.ok) {
        toast(`${t.full_name} bugün yok. ${res.moved} müşteri yeniden dağıtıldı.`);
        setTarget(null);
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  };

  return (
    <>
      <div className={s.team}>
        {rows.map((r) => {
          const pct = r.assigned > 0 ? Math.min(100, Math.round((r.done / r.assigned) * 100)) : 0;
          return (
            <div className={s.member} key={r.member_id}>
              <Avatar name={r.full_name} />
              <div style={{ minWidth: 0 }}>
                <div className={s.memberName}>
                  {r.full_name}
                  {r.absent ? <Chip className={s.absent}>Bugün yok</Chip> : null}
                </div>
                <div
                  className={s.mini}
                  role="progressbar"
                  aria-label={`${r.full_name} ilerleme`}
                  aria-valuemin={0}
                  aria-valuemax={r.assigned}
                  aria-valuenow={r.done}
                >
                  <i style={{ width: `${pct}%` }} />
                </div>
                <div className={s.meta}>
                  Ulaşılan {r.reached} · Randevu {r.appointments}
                  {r.retries > 0 ? ` · Tekrar ${r.retries}` : ""}
                </div>
              </div>
              <div className={s.right}>
                <b>
                  {r.done}/{r.assigned}
                </b>
                {canMarkAbsent && !r.absent ? (
                  <Button variant="soft" size="sm" onClick={() => setTarget(r)}>
                    Bugün yok
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={target !== null} onClose={() => (pending ? undefined : setTarget(null))} title="Bugün yok olarak işaretle">
        <p className={s.confirmText}>
          {target?.full_name} bugün yok sayılacak. Bekleyen müşterileri diğer çalışanlara eşit dağıtılır. Bu işlem geri alınamaz.
        </p>
        <div className="modal-foot">
          <Button variant="soft" onClick={() => setTarget(null)} disabled={pending}>
            Vazgeç
          </Button>
          <Button variant="ink" onClick={confirm} disabled={pending} data-autofocus>
            {pending ? "İşleniyor" : "Onayla"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
