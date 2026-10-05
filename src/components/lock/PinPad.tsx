"use client";

import { useEffect, useRef, useState } from "react";
import s from "./lock.module.css";

export type PinPadProps = {
  /** Hane sayısı (PIN: 6). */
  length: number;
  /** Tüm haneler girilince çağrılır; giriş ardından temizlenir. */
  onComplete: (pin: string) => void;
  /** Gösterilecek hata (yanlış PIN, eşleşmeme). */
  error?: string | null;
  disabled?: boolean;
  /** Ekran okuyucu etiketi. */
  label?: string;
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/**
 * PIN noktaları + rakam tuş takımı. Masaüstünde klavye rakamları ve Backspace de çalışır
 * (odak bir metin alanında değilken). Görsel stil sade; sahne kardeş şeritte.
 */
export function PinPad({ length, onComplete, error, disabled, label = "PIN" }: PinPadProps) {
  const [digits, setDigits] = useState("");
  const digitsRef = useRef("");

  const set = (v: string) => {
    digitsRef.current = v;
    setDigits(v);
  };
  const press = (d: string) => {
    if (disabled) return;
    const next = digitsRef.current + d;
    if (next.length > length) return;
    if (next.length === length) {
      set("");
      onComplete(next);
    } else {
      set(next);
    }
  };
  const back = () => {
    if (!disabled) set(digitsRef.current.slice(0, -1));
  };

  const pressRef = useRef(press);
  const backRef = useRef(back);
  useEffect(() => {
    pressRef.current = press;
    backRef.current = back;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        pressRef.current(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        backRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={error ? `${s.pad} ${s.err}` : s.pad}>
      <div className={s.dots} role="img" aria-label={`${label}: ${digits.length} / ${length} hane girildi`} data-testid="pin-dots">
        {Array.from({ length }, (_, i) => (
          <span key={i} className={i < digits.length ? `${s.dot} ${s.dotOn}` : s.dot} />
        ))}
      </div>
      <div className={s.msg} role="alert" aria-live="assertive">
        {error ?? ""}
      </div>
      <div className={s.keys} role="group" aria-label={`${label} tuş takımı`}>
        {KEYS.map((k) => (
          <button key={k} type="button" className={s.key} onClick={() => press(k)} disabled={disabled}>
            {k}
          </button>
        ))}
        <span aria-hidden="true" />
        <button type="button" className={s.key} onClick={() => press("0")} disabled={disabled}>
          0
        </button>
        <button type="button" className={`${s.key} ${s.keyGhost}`} onClick={back} disabled={disabled} aria-label="Sil">
          Sil
        </button>
      </div>
    </div>
  );
}
