"use client";

import { WhatsAppGlyph } from "@/components/icons/WhatsAppGlyph";
import { OperatorLogo } from "@/components/ui/OperatorLogo";
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
  isCallOpen,
  logText,
  type Item,
  type Outcome,
} from "./model";
import styles from "./bugun.module.css";

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
    sub: "Gün ve saat seç",
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
              <OperatorLogo operator={item.operator} />
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
            <WhatsAppGlyph className={styles.waGlyph} />
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
