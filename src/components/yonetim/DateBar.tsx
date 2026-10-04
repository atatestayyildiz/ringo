"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import s from "./yonetim.module.css";

function shift(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

export function DateBar({ day, today }: { day: string; today: string }) {
  const router = useRouter();
  const go = (d: string) => router.push(d === today ? "/yonetim" : `/yonetim?gun=${d}`);

  return (
    <div className={s.bar}>
      <Button variant="soft" size="sm" aria-label="Önceki gün" onClick={() => go(shift(day, -1))}>
        &lsaquo;
      </Button>
      <input
        type="date"
        className={`input ${s.dateInput}`}
        aria-label="Gün seç"
        value={day}
        max={today}
        onChange={(e) => {
          const v = e.target.value;
          if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v <= today) go(v);
        }}
      />
      <Button variant="soft" size="sm" aria-label="Sonraki gün" disabled={day >= today} onClick={() => go(shift(day, 1))}>
        &rsaquo;
      </Button>
      {day !== today ? (
        <Button variant="ink" size="sm" onClick={() => go(today)}>
          Bugün
        </Button>
      ) : null}
    </div>
  );
}
