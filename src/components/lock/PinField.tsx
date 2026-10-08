"use client";

import { useEffect, useRef, useState } from "react";
import sc from "@/components/scene/scene.module.css";
import { useDismiss } from "@/components/scene/useDismiss";
import s from "./lock.module.css";

export type PinFieldProps = {
  /** Hane sayısı. Esnek kipte üst sınırdır (en çok 8). */
  length: number;
  /**
   * Esnek kip (PIN belirleme, ilk adım): hane sayısı önceden bilinmez. En az `min` daire çizilir, her yeni
   * hanede daire eklenir; tamamlanınca otomatik gönderilmez, Enter ya da "Devam" ile onComplete çağrılır.
   */
  flexible?: { min: number };
  /** Gizli alanın erişilebilir adı (ör. "PIN", "Yeni PIN"). */
  label: string;
  /** Daireler görünmeden önceki metin düğmesi (ör. "PIN gir"). */
  trigger: string;
  /** Tüm haneler girilince çağrılır. */
  onComplete: (pin: string) => void;
  /** Gösterilecek hata (yanlış PIN, eşleşmeme); kalan hak metni dahil. */
  error?: string | null;
  /** Değişince haneler temizlenir; hata varsa daireler kısa süre kırmızı dolu kalır. */
  resetKey?: number;
  /** Değişince daireler yeniden çizilir (ör. PIN belirlemede ikinci adım). */
  redrawKey?: number | string;
  /** Gönderim sürüyor ya da çıkılıyor: giriş kabul edilmez (klavye açık kalır). */
  busy?: boolean;
  /** Her yeni hanede (sahne halka nabzı için). */
  onDigit?: () => void;
};

/**
 * PIN girişi: alt ortada "PIN gir" metin düğmesi; basınca `length` daire (esnek kipte en az `min`) tek tek çizilerek (stroke-dashoffset)
 * belirir ve yerel klavye açılır (gizli alan: inputMode numeric, mobilde sayısal klavye). Ekranda tuş
 * takımı yok. Masaüstünde düğmeye basmadan rakam yazmak da daireleri açar. Dışarı dokunmak ya da Escape
 * daireleri söndürür (alan odağı bırakır, klavye kapanır), metin düğmesi geri gelir. Daireler
 * [data-scene-shake] taşır: Scene.error() yanlışta onları sallar.
 */
export function PinField({ length, flexible, label, trigger, onComplete, error = null, resetKey = 0, redrawKey = 0, busy = false, onDigit }: PinFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [revealed, setRevealed] = useState(false);
  const [digits, setDigits] = useState("");
  const [flash, setFlash] = useState(false);
  const [closing, setClosing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [seenReset, setSeenReset] = useState(resetKey);
  const sent = useRef<string | null>(null);

  // Sıfırlama isteği (yanlış PIN, ilk adım bitti): haneleri temizle; hatada kırmızı dolu daireler kısa kalır.
  if (resetKey !== seenReset) {
    setSeenReset(resetKey);
    setDigits("");
    setFlash(Boolean(error));
  }
  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(false), 480);
    return () => window.clearTimeout(id);
  }, [flash, resetKey]);

  const busyRef = useRef(busy);
  const digitsRef = useRef(digits);
  useEffect(() => {
    busyRef.current = busy;
    digitsRef.current = digits;
  });

  const accept = (raw: string) => {
    if (busyRef.current) return;
    const v = raw.replace(/\D/g, "").slice(0, length);
    const prev = digitsRef.current;
    digitsRef.current = v;
    setFlash(false);
    setDigits(v);
    if (v.length > prev.length) onDigit?.();
    if (flexible) {
      sent.current = null;
    } else if (v.length === length && sent.current !== v) {
      sent.current = v;
      onComplete(v);
    } else if (v.length < length) {
      sent.current = null;
    }
  };
  const acceptRef = useRef(accept);
  useEffect(() => {
    acceptRef.current = accept;
  });

  /** Esnek kip: yeterli hane varsa girilen PIN'i gönderir (Enter ya da "Devam"). */
  const submitFlexible = () => {
    const v = digitsRef.current;
    if (!flexible || busyRef.current || v.length < flexible.min || sent.current === v) return;
    sent.current = v;
    onComplete(v);
  };

  /** Daireleri açar ve gizli alana odaklanır (dokunmada mobil klavye açılır: aynı jest içinde çağrılmalı). */
  const reveal = () => {
    setRevealed(true);
    inputRef.current?.focus({ preventScroll: true });
  };
  const dismiss = () => {
    if (closing) return;
    inputRef.current?.blur();
    setClosing(true);
    window.setTimeout(() => {
      setRevealed(false);
      setClosing(false);
      digitsRef.current = "";
      setDigits("");
      sent.current = null;
    }, 280);
  };
  useDismiss(revealed && !closing, rootRef, dismiss, busy);

  const revealRef = useRef(reveal);
  useEffect(() => {
    revealRef.current = reveal;
  });

  // Masaüstü: odak alanda değilken rakam yazmak daireleri açar ve haneyi ekler.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const input = inputRef.current;
      const t = e.target as HTMLElement | null;
      if (!input || t === input) return;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        revealRef.current();
        const base = digitsRef.current.length >= length ? "" : digitsRef.current;
        acceptRef.current(base + e.key);
      } else if (e.key === "Backspace" && digitsRef.current) {
        e.preventDefault();
        revealRef.current();
        acceptRef.current(digitsRef.current.slice(0, -1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [length]);

  const min = flexible?.min ?? length;
  const red = Boolean(error) && flash;
  const cells = flexible ? Math.min(length, Math.max(min, digits.length)) : length;
  const filled = flash ? cells : digits.length;
  const canGo = Boolean(flexible) && revealed && !closing && digits.length >= min;

  return (
    <div ref={rootRef} className={s.field} data-revealed={revealed ? "" : undefined} data-closing={closing ? "" : undefined}>
      <div className={s.slot}>
        <button type="button" className={`${sc.trigger} ${s.trigger}`} onClick={reveal} tabIndex={revealed ? -1 : 0} aria-hidden={revealed || undefined}>
          {trigger}
        </button>
        <div className={s.circlesWrap}>
          <div
            key={String(redrawKey)}
            className={`${s.circles} ${red ? s.err : ""}`}
            data-testid="pin-dots"
            data-filled={filled}
            style={{ "--n": cells } as React.CSSProperties}
            data-scene-shake=""
            aria-hidden="true"
            // Dairelere dokunmak klavyeyi yeniden açar (odak aynı jestte).
            onClick={reveal}
          >
            {Array.from({ length: cells }, (_, i) => (
              // Sonradan eklenen daire gecikmesiz çizilir (açılışta yalnız en az `min` daire sırayla belirir).
              <span key={i} className={s.cell} style={{ "--i": i < min ? i : 0 } as React.CSSProperties} data-on={i < filled ? "" : undefined}>
                <svg viewBox="0 0 44 44">
                  <circle className={s.ringC} cx="22" cy="22" r="18" pathLength={100} transform="rotate(-90 22 22)" />
                  <circle className={s.dotC} cx="22" cy="22" r="6.5" />
                </svg>
              </span>
            ))}
          </div>
          <input
            ref={inputRef}
            className={s.hidden}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="done"
            maxLength={length}
            aria-label={label}
            aria-describedby={error ? "pin-msg" : undefined}
            tabIndex={revealed ? 0 : -1}
            value={digits}
            readOnly={busy}
            onFocus={() => {
              if (!closing) setRevealed(true);
            }}
            onChange={(e) => accept(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (flexible) {
                submitFlexible();
              } else if (digitsRef.current.length === length && !busyRef.current) {
                sent.current = null;
                accept(digitsRef.current);
              }
            }}
          />
        </div>
      </div>
      {flexible ? (
        <button type="button" className={s.go} data-show={canGo ? "" : undefined} disabled={!canGo || busy} tabIndex={canGo ? 0 : -1} onClick={submitFlexible}>
          Devam
        </button>
      ) : null}
      <div id="pin-msg" className={s.msg} role="alert" aria-live="assertive">
        {error ?? ""}
      </div>
    </div>
  );
}
