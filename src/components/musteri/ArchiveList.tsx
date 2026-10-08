"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { claimArchiveAction } from "@/app/(app)/musteriler/gecmis/actions";
import { OUTCOME_LABEL } from "@/components/bugun/model";
import { Button, useToast } from "@/components/ui";
import { OperatorLogo } from "@/components/ui/OperatorLogo";
import { formatDate, formatPhone } from "@/lib/format";
import { ARCHIVE_CLAIM_MAX, formatAmount, STAGE_LABEL, type ArchiveRow } from "./shared";
import "./musteri.css";

const STATUS_TEXT: Record<string, string> = {
  disqualified: "Uygun değil",
  unreachable: "Ulaşılamadı",
  done: "Kapandı",
};

function outcomeText(r: ArchiveRow): string {
  if (r.last_outcome && OUTCOME_LABEL[r.last_outcome as keyof typeof OUTCOME_LABEL]) {
    return OUTCOME_LABEL[r.last_outcome as keyof typeof OUTCOME_LABEL];
  }
  return (r.pipeline_stage && STAGE_LABEL[r.pipeline_stage]) || STATUS_TEXT[r.call_status] || "-";
}

/**
 * Geçmiş dönem tablosu: çalışan satırları işaretler (en fazla 10), "Bana ata" ile müşteriler bugünkü listesine
 * bekleyen olarak düşer.
 */
export function ArchiveList({ rows, filtered }: { rows: ArchiveRow[]; filtered: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const full = picked.size >= ARCHIVE_CLAIM_MAX;

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < ARCHIVE_CLAIM_MAX) next.add(id);
      return next;
    });

  const claim = () => {
    const ids = [...picked];
    start(async () => {
      const res = await claimArchiveAction(ids);
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      setPicked(new Set());
      if (res.claimed === 0) {
        toast("Seçilen müşteriler başkası tarafından alınmış.", "error");
        router.refresh();
        return;
      }
      toast(
        res.skipped > 0
          ? `${res.claimed} müşteri listene eklendi, ${res.skipped} tanesi başkası tarafından alınmış.`
          : `${res.claimed} müşteri listene eklendi.`,
      );
      router.push("/bugun");
    });
  };

  if (rows.length === 0) {
    return (
      <p className="ar-empty">
        {filtered ? "Bu filtreye uyan geçmiş dönem müşterisi yok." : "Geçmiş dönemde aranabilecek müşteri yok. Kapanan müşteriler en az 1 gün sonra burada görünür."}
      </p>
    );
  }

  return (
    <>
      <div className="ar-scroll">
        <table className="ar-table">
          <thead>
            <tr>
              <th scope="col" className="ar-chk">
                <span className="sr">Seç</span>
              </th>
              <th scope="col">Müşteri</th>
              <th scope="col">Operatör</th>
              <th scope="col">Tutar</th>
              <th scope="col">Son sonuç</th>
              <th scope="col">Son işlem</th>
              <th scope="col">Görüşme</th>
              <th scope="col">Son not</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const on = picked.has(r.id);
              const amount = formatAmount(r.amount);
              return (
                <tr key={r.id} data-on={on ? "" : undefined}>
                  <td className="ar-chk">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!on && full}
                      onChange={() => toggle(r.id)}
                      aria-label={`${r.full_name} seç`}
                    />
                  </td>
                  <td>
                    <b>{r.full_name}</b>
                    <small>{formatPhone(r.phone)}</small>
                  </td>
                  <td>{r.operator ? <OperatorLogo operator={r.operator} /> : "-"}</td>
                  <td>{amount ? `${amount.value}${amount.unit ? ` ${amount.unit}` : ""}` : "-"}</td>
                  <td>
                    {outcomeText(r)}
                    {r.revived_before ? <small>Daha önce yeniden arandı</small> : null}
                  </td>
                  <td>{formatDate(r.closed_at)}</td>
                  <td>
                    {r.call_count} arama
                    {r.last_caller ? <small>{r.last_caller}</small> : null}
                  </td>
                  <td className="ar-note" title={r.last_note ?? undefined}>
                    {r.last_note ?? "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {picked.size > 0 ? (
        <div className="ar-bar" role="region" aria-label="Seçim">
          <span>
            {picked.size} müşteri seçili{full ? " (en fazla " + ARCHIVE_CLAIM_MAX + ")" : ""}
          </span>
          <Button variant="soft" size="sm" onClick={() => setPicked(new Set())} disabled={pending}>
            Temizle
          </Button>
          <Button variant="brand" size="sm" onClick={claim} disabled={pending}>
            {pending ? "Ekleniyor" : "Bana ata ve ara"}
          </Button>
        </div>
      ) : null}
    </>
  );
}
