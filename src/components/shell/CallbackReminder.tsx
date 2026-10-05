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
const STORE_KEY = "telefoncu.callback-reminder.collapsed";

const keyOf = (d: Due) => `${d.id}|${d.at}`;

function readCollapsed(): string[] {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeCollapsed(keys: string[]) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(keys.slice(-200)));
  } catch {
    /* depolama yoksa yalnız bu oturumda küçük kalır */
  }
}

/**
 * Vakti gelmiş geri aramalar için uygulama içi hatırlatma.
 * Kaynak: bugünkü listemdeki, son sonucu "Sonra ara" (callback), durumu "tekrar ara" ve next_call_at <= şimdi olan müşteriler (RLS kapsamı).
 * Kapat: liste doluysa kart tek satıra küçülür ve ekranda kalır; aramalar işlenip liste boşalınca kendiliğinden kaybolur.
 * Küçültüldükten sonra vakti gelen yeni bir müşteri kartı yeniden açar.
 */
export function CallbackReminder({ memberId }: { memberId: string }) {
  const pathname = usePathname();
  const [due, setDue] = useState<Due[]>([]);
  const [collapsedKeys, setCollapsedKeys] = useState<string[]>([]);
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
      setCollapsedKeys(readCollapsed());
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

  if (!due.length) return null;

  const collapsed = due.every((d) => collapsedKeys.includes(keyOf(d)));
  const shown = due.slice(0, MAX_ROWS);
  const more = due.length - shown.length;

  function collapse() {
    const next = [...new Set([...readCollapsed(), ...collapsedKeys, ...due.map(keyOf)])];
    writeCollapsed(next);
    setCollapsedKeys(next);
  }

  function expand() {
    const open = new Set(due.map(keyOf));
    const next = [...new Set([...readCollapsed(), ...collapsedKeys])].filter((k) => !open.has(k));
    writeCollapsed(next);
    setCollapsedKeys(next);
  }

  if (collapsed) {
    const first = due[0];
    const tel = telLink(first.phone);
    return (
      <div className={styles.region} role="status" aria-live="polite">
        <section className={`${styles.card} ${styles.mini}`} aria-label="Geri arama vakti">
          <button type="button" className={styles.miniOpen} onClick={expand} aria-label="Hatırlatmayı genişlet">
            <span className={styles.ico} aria-hidden="true">
              <IconClock />
            </span>
            <span className={styles.miniText}>
              <b>Geri arama vakti:</b> {first.name}
              {due.length > 1 ? ` ve ${due.length - 1} kişi daha` : ""}
            </span>
          </button>
          <a
            className={`${styles.call} ${styles.callMini}${tel ? "" : ` ${styles.off}`}`}
            href={tel ?? undefined}
            aria-disabled={!tel}
            aria-label={`${first.name} ara`}
          >
            <IconPhone />
            Ara
          </a>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.region} role="status" aria-live="polite">
      <section className={styles.card} aria-label="Geri arama vakti">
        <div className={styles.head}>
          <span className={styles.ico} aria-hidden="true">
            <IconClock />
          </span>
          <h2>Geri arama vakti</h2>
          <button type="button" className={styles.close} onClick={collapse} aria-label="Hatırlatmayı küçült">
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
          <button type="button" className={styles.dismiss} onClick={collapse}>
            Kapat
          </button>
        </div>
      </section>
    </div>
  );
}
