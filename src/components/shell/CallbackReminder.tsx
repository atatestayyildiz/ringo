"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconClock, IconPhone, IconX } from "@/components/icons";
import { dayKey, formatTime, telLink } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import styles from "./CallbackReminder.module.css";

type Due = { id: string; name: string; phone: string; at: string };

const POLL_MS = 60_000;
const MAX_ROWS = 3;
const STORE_KEY = "telefoncu.callback-reminder.dismissed";

const keyOf = (d: Due) => `${d.id}|${d.at}`;

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeDismissed(keys: string[]) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(keys.slice(-200)));
  } catch {
    /* depolama yoksa yalnız bu oturumda kapalı kalır */
  }
}

/**
 * Vakti gelmiş geri aramalar için uygulama içi hatırlatma.
 * Kaynak: bugünkü listemdeki, son sonucu "Sonra ara" (callback), durumu "tekrar ara" ve next_call_at <= şimdi olan müşteriler (RLS kapsamı).
 */
export function CallbackReminder({ memberId }: { memberId: string }) {
  const pathname = usePathname();
  const [due, setDue] = useState<Due[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const supabase = createClient();
      const now = new Date();
      const { data: rows } = await supabase
        .from("daily_assignments")
        .select("customer_id")
        .eq("day", dayKey(now))
        .eq("member_id", memberId);
      const ids = (rows ?? []).map((r) => r.customer_id);
      if (!ids.length) {
        if (alive.current) setDue([]);
        return;
      }
      const { data } = await supabase
        .from("customers")
        .select("id, full_name, phone, next_call_at")
        .in("id", ids)
        .eq("call_status", "retry")
        // Yalnız "Sonra ara" ile seçilen saat: Açmadı/Meşgul de retry yapar ama next_call_at = şimdi'dir.
        .eq("last_outcome", "callback")
        .lte("next_call_at", now.toISOString())
        .order("next_call_at");
      if (!alive.current || !data) return;
      setDue(
        data.map((c) => ({ id: c.id, name: c.full_name, phone: c.phone, at: c.next_call_at })),
      );
    } catch {
      /* ağ hatası: bir sonraki turda yeniden denenir */
    }
  }, [memberId]);

  useEffect(() => {
    alive.current = true;
    const first = window.setTimeout(() => {
      setDismissed(readDismissed());
      void load();
    }, 0);
    const timer = window.setInterval(() => void load(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive.current = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // Sayfa değişince (ör. arama sonucu kaydedilince) hemen yeniden sorgula
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 400);
    return () => window.clearTimeout(t);
  }, [pathname, load]);

  const visible = due.filter((d) => !dismissed.includes(keyOf(d)));
  if (!visible.length) return null;

  const shown = visible.slice(0, MAX_ROWS);
  const more = visible.length - shown.length;

  function close() {
    const next = [...new Set([...readDismissed(), ...dismissed, ...visible.map(keyOf)])];
    writeDismissed(next);
    setDismissed(next);
  }

  return (
    <div className={styles.region} role="status" aria-live="polite">
      <section className={styles.card} aria-label="Geri arama vakti">
        <div className={styles.head}>
          <span className={styles.ico} aria-hidden="true">
            <IconClock />
          </span>
          <h2>Geri arama vakti</h2>
          <button type="button" className={styles.close} onClick={close} aria-label="Hatırlatmayı kapat">
            <IconX />
          </button>
        </div>
        <ul className={styles.list}>
          {shown.map((d) => {
            const tel = telLink(d.phone);
            return (
              <li key={keyOf(d)} className={styles.row}>
                <Link href={`/bugun?m=${d.id}`} className={styles.who}>
                  <b>{d.name}</b>
                  <span>Saat {formatTime(d.at)}</span>
                </Link>
                <a
                  className={`${styles.call}${tel ? "" : ` ${styles.off}`}`}
                  href={tel ?? undefined}
                  aria-disabled={!tel}
                >
                  <IconPhone />
                  Ara
                </a>
              </li>
            );
          })}
        </ul>
        {more > 0 ? <p className={styles.more}>ve {more} kişi daha</p> : null}
        <div className={styles.foot}>
          <button type="button" className={styles.dismiss} onClick={close}>
            Kapat
          </button>
        </div>
      </section>
    </div>
  );
}
