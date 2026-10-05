"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { takeFromPoolAction } from "@/app/(app)/havuz/actions";
import { OPERATOR_LABEL, OUTCOME_LABEL } from "@/components/musteri/shared";
import { Avatar, Button, Chip, useToast } from "@/components/ui";
import { dayDiff, formatDayMonth } from "@/lib/format";
import "./havuz.css";

export type PoolRow = {
  id: string;
  full_name: string;
  operator: string | null;
  pool_count: number;
  next_call_at: string;
  last_member_name: string | null;
  last_outcome: string | null;
};

function returnText(iso: string): { main: string; sub: string } {
  const diff = dayDiff(iso);
  const date = formatDayMonth(iso);
  if (diff < 0) return { main: "Süresi doldu", sub: "Sonraki dağıtımda listeye çıkar" };
  if (diff === 0) return { main: "Bugün", sub: `${date}, sonraki dağıtımda listeye çıkar` };
  if (diff === 1) return { main: "Yarın", sub: date };
  return { main: `${diff} gün sonra`, sub: date };
}

/** canTake false (serbest havuz modu): yalnız görüntüleme, "Kendime al" yok. */
export function PoolList({
  rows,
  maxRounds,
  canTake = true,
}: {
  rows: PoolRow[];
  maxRounds: number;
  canTake?: boolean;
}) {
  const toast = useToast();
  const [taken, setTaken] = useState<Set<string>>(() => new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: number; name: string } | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const visible = rows.filter((r) => !taken.has(r.id));

  function take(row: PoolRow) {
    if (busyId) return;
    setBusyId(row.id);
    startTransition(async () => {
      try {
        const res = await takeFromPoolAction(row.id);
        if (res.ok) {
          setTaken((s) => new Set(s).add(row.id));
          setNotice({ id: Date.now(), name: res.name });
        } else {
          toast(res.error, "error");
        }
      } catch {
        toast("Bağlantı kurulamadı. İnternetinizi kontrol edip tekrar deneyin.", "error");
      } finally {
        setBusyId(null);
      }
    });
  }

  return (
    <>
      <p className="hv-count">
        <Chip>{visible.length} müşteri</Chip>
      </p>
      {visible.length === 0 ? (
        <p className="hv-empty">Havuzda bekleyen müşteri kalmadı.</p>
      ) : (
        <ul className="mu-list" aria-label="Havuzdaki müşteriler">
          {visible.map((c) => {
            const r = returnText(c.next_call_at);
            const meta = [
              c.operator ? (OPERATOR_LABEL[c.operator] ?? c.operator) : null,
              c.last_member_name ? `Son: ${c.last_member_name}` : null,
            ]
              .filter(Boolean)
              .join(", ");
            const busy = busyId === c.id;
            return (
              <li key={c.id} data-testid="pool-row">
                <div className="mu-pool-row hv-row">
                  <span className="mu-who">
                    <Avatar name={c.full_name} />
                    <span style={{ minWidth: 0 }}>
                      <b>{c.full_name}</b>
                      <span>{meta}</span>
                    </span>
                  </span>
                  <span className="mu-days">
                    <b>{r.main}</b>
                    <span>{r.sub}</span>
                  </span>
                  <span className="mu-cell hv-meta" title="Havuza düşme sayısı">
                    <Chip>
                      Havuz {c.pool_count} / {maxRounds}
                    </Chip>
                    {c.last_outcome ? (
                      <span className="hv-outcome">{OUTCOME_LABEL[c.last_outcome] ?? ""}</span>
                    ) : null}
                  </span>
                  {canTake ? (
                    <span className="hv-action">
                      <Button
                        size="sm"
                        variant="brand"
                        onClick={() => take(c)}
                        disabled={busyId !== null}
                        aria-busy={busy}
                        aria-label={`${c.full_name} kendime al`}
                      >
                        {busy ? "Alınıyor" : "Kendime al"}
                      </Button>
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {notice ? (
        <div className="toast-region hv-notice-region" role="status" aria-live="polite">
          <div key={notice.id} className="toast hv-notice">
            <span>{notice.name} listene eklendi</span>
            <Link href="/bugun" className="hv-notice-link">
              Bugün&apos;e git
            </Link>
          </div>
        </div>
      ) : null}
    </>
  );
}
