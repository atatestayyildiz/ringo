"use client";

import { useState } from "react";
import {
  IconAlert,
  IconCheck,
  IconClock,
  IconPhone,
  IconStore,
  IconX,
  type IconProps,
} from "@/components/icons";
import { Avatar, Chip } from "@/components/ui";
import { formatPhone, relativeTime, telLink, waLink } from "@/lib/format";
import {
  OPERATORS,
  isCallOpen,
  logText,
  type Item,
  type Outcome,
} from "./model";
import styles from "./bugun.module.css";

/** WhatsApp resmi amblemi (tek renkli glif), satır içi SVG. */
function WhatsAppGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className={styles.waGlyph}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.62.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35m-5.42 7.4h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.82 9.82 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.88 9.88m8.41-18.3A11.8 11.8 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.9 11.9 0 0 0 5.69 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.17-3.48-8.41Z" />
    </svg>
  );
}

const OUTCOME_BUTTONS: {
  outcome: Outcome;
  Icon: (p: IconProps) => React.ReactElement;
  title: string;
  sub: string;
  color: string;
}[] = [
  {
    outcome: "appointment",
    Icon: IconStore,
    title: "Dükkana gelecek",
    sub: "Randevu oluştur",
    color: "var(--c-done)",
  },
  {
    outcome: "callback",
    Icon: IconClock,
    title: "Sonra ara",
    sub: "Saat seç",
    color: "var(--c-retry)",
  },
  {
    outcome: "no_answer",
    Icon: IconX,
    title: "Açmadı",
    sub: "Tekrar listesine",
    color: "var(--c-retry)",
  },
  {
    outcome: "busy",
    Icon: IconPhone,
    title: "Meşgul",
    sub: "Tekrar listesine",
    color: "var(--c-retry)",
  },
  {
    outcome: "disqualified",
    Icon: IconAlert,
    title: "Uygun değil",
    sub: "İcra, kredi puanı…",
    color: "var(--c-bad)",
  },
  {
    outcome: "not_interested",
    Icon: IconCheck,
    title: "İlgilenmiyor",
    sub: "Kapat",
    color: "var(--c-pool)",
  },
];

const CLOSED_TEXT: Partial<Record<Item["status"], string>> = {
  done: "Bu müşteri tamamlandı.",
  pool: "Bu müşteri havuzda, süresi dolunca listeye döner.",
  unreachable: "Bu müşteri ulaşılamadı olarak kapandı.",
  disqualified: "Bu müşteri uygun değil olarak kapandı.",
};

export function FocusCard({
  item,
  busy,
  onPick,
}: {
  item: Item;
  busy: boolean;
  onPick: (outcome: Outcome, note: string) => void;
}) {
  const [note, setNote] = useState("");
  const open = isCallOpen(item.status);
  const tel = telLink(item.phone);
  const wa = waLink(item.phone);
  const callbackLabel =
    item.status === "retry" &&
    item.log[item.log.length - 1]?.outcome === "callback"
      ? relativeTime(item.nextCallAt)
      : null;

  return (
    <>
      <div className={styles.focusTop}>
        <div className={styles.who}>
          <Avatar name={item.name} size={64} radius={22} />
          <div style={{ minWidth: 0 }}>
            <h3>{item.name}</h3>
            <div className={styles.num}>{formatPhone(item.phone)}</div>
            {item.owner ? (
              <div className={styles.owner}>{item.owner} listesinde</div>
            ) : null}
          </div>
        </div>
        <div className={styles.chips}>
          {item.operator ? (
            <Chip>
              <i className={styles.chipDot} />
              {OPERATORS[item.operator] ?? item.operator}
            </Chip>
          ) : null}
          <Chip>{item.sourceLabel}</Chip>
          {item.appliedLabel ? (
            <Chip className={styles.chipIco}>
              <IconClock />
              Başvuru {item.appliedLabel}
            </Chip>
          ) : null}
          {item.tries > 0 ? (
            <Chip color="var(--c-retry)">{item.tries}. deneme yapıldı</Chip>
          ) : null}
          {callbackLabel ? (
            <Chip color="var(--c-retry)">Geri arama {callbackLabel}</Chip>
          ) : null}
        </div>
        <div className={styles.notes}>
          {item.log.length ? (
            <>
              <b>Önceki notlar:</b> {item.log.map(logText).join(" · ")}
            </>
          ) : (
            <>
              <b>İlk arama.</b> Bu müşteriyle daha önce görüşülmedi.
            </>
          )}
        </div>
        <div className={styles.callRow}>
          <a
            className={`${styles.btn} ${styles.btnCall}${tel ? "" : ` ${styles.btnDisabled}`}`}
            href={tel ?? undefined}
            aria-disabled={!tel}
          >
            <span className={styles.ring}>
              <IconPhone />
            </span>
            Ara
          </a>
          <a
            className={`${styles.btn} ${styles.btnWa}${wa ? "" : ` ${styles.btnDisabled}`}`}
            href={wa ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="WhatsApp mesajı"
            aria-disabled={!wa}
          >
            <WhatsAppGlyph />
            WhatsApp
          </a>
        </div>
      </div>
      <div
        className={`${styles.outcomes}${open ? "" : ` ${styles.outcomesClosed}`}`}
      >
        <p>Görüşme nasıl bitti?</p>
        {open ? null : (
          <div className={styles.closedNote} role="status">
            {CLOSED_TEXT[item.status] ?? "Bu müşteri için arama kaydı kapalı."}{" "}
            Aşama değişikliği için Müşteriler ekranını kullanın.
          </div>
        )}
        <div className={styles.ogrid}>
          {OUTCOME_BUTTONS.map(({ outcome, Icon, title, sub, color }) => (
            <button
              key={outcome}
              type="button"
              className={styles.o}
              disabled={busy || !open}
              onClick={() => onPick(outcome, note)}
            >
              <span className={styles.tag} style={{ background: color }}>
                <Icon />
              </span>
              {title}
              <small>{sub}</small>
            </button>
          ))}
        </div>
        <textarea
          className={styles.noteInput}
          rows={2}
          maxLength={1000}
          placeholder="Not ekle (isteğe bağlı)"
          aria-label="Görüşme notu"
          disabled={!open}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </>
  );
}
