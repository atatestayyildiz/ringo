"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

function shift(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** Huni: randevu gününe göre süzme. Gün yoksa tüm huni. */
export function FunnelDateBar({ day, today }: { day: string | null; today: string }) {
  const router = useRouter();
  const go = (d: string | null) => router.push(d ? `/huni?gun=${d}` : "/huni");
  const base = day ?? today;

  return (
    <div className="mu-datebar" role="group" aria-label="Randevu gününe göre süz">
      <Button variant="soft" size="sm" aria-label="Önceki gün" onClick={() => go(shift(base, -1))}>
        &lsaquo;
      </Button>
      <input
        type="date"
        className="input mu-date-input"
        aria-label="Randevu günü seç"
        value={day ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          if (/^\d{4}-\d{2}-\d{2}$/.test(v)) go(v);
          else if (v === "") go(null);
        }}
      />
      <Button variant="soft" size="sm" aria-label="Sonraki gün" onClick={() => go(shift(base, 1))}>
        &rsaquo;
      </Button>
      {day !== today ? (
        <Button variant="soft" size="sm" onClick={() => go(today)}>
          Bugün
        </Button>
      ) : null}
      {day ? (
        <Button variant="ink" size="sm" onClick={() => go(null)}>
          Tümü
        </Button>
      ) : null}
    </div>
  );
}
