"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { rescueLostAction } from "@/app/(app)/yonetim/actions";
import { Button, Card, useToast } from "@/components/ui";
import s from "./yonetim.module.css";

export type LostCounts = {
  total: number;
  owner_inactive: number;
  owner_absent: number;
  unlisted: number;
  unowned_retry: number;
};

/** Hiçbir listede görünmeyen açık müşteriler. Yalnız sorun varsa görünür. */
export function LostCustomers({ counts, canRescue }: { counts: LostCounts; canRescue: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const rescuable = counts.owner_inactive + counts.unowned_retry;

  const rescue = () =>
    start(async () => {
      const res = await rescueLostAction();
      if (res.ok) {
        toast(res.moved > 0 ? `${res.moved} müşteri sıraya bırakıldı.` : "Sıraya bırakılacak müşteri yok.");
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });

  const lines: [number, string][] = [
    [counts.owner_inactive, "Pasif çalışanda kalmış"],
    [counts.unowned_retry, "Sahipsiz tekrar arama"],
    [counts.owner_absent, "İzinli çalışanın, dönünce listeye girecek"],
    [counts.unlisted, "Listeye girmesi gecikmiş, birazdan otomatik girer"],
  ];

  return (
    <Card className={s.lost} data-testid="lost-customers">
      <h2>Görünmeyen müşteriler</h2>
      <p className={s.lostLead}>
        Bugün aranması gereken <b>{counts.total}</b> müşteri kimsenin listesinde ya da sırada görünmüyor.
      </p>
      <ul className={s.lostList}>
        {lines
          .filter(([n]) => n > 0)
          .map(([n, label]) => (
            <li key={label}>
              <b>{n}</b>
              <span>{label}</span>
            </li>
          ))}
      </ul>
      {canRescue && rescuable > 0 ? (
        <Button variant="brand" onClick={rescue} disabled={pending}>
          {pending ? "Bırakılıyor" : `${rescuable} müşteriyi sıraya bırak`}
        </Button>
      ) : null}
    </Card>
  );
}
