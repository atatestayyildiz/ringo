"use client";

import { useEffect, useRef, useState } from "react";
import s from "./lock.module.css";

export type PinPadProps = {
  /** Hane sayısı (PIN: 6). */
  length: number;
  /** Tüm haneler girilince çağrılır. Noktalar dolu kalır; disabled bitince (hatada sallanmadan sonra) temizlenir. */
  onComplete: (pin: string) => void;
  /** Gösterilecek hata (yanlış PIN, eşleşmeme). */
  error?: string | null;
  disabled?: boolean;
  /** Ekran okuyucu etiketi. */
  label?: string;
  /** Her tuşta (rakam ya da sil): sahne halka nabzı için. */
  onKey?: (kind: "digit" | "back") => void;
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/**
 * PIN noktaları + rakam tuş takımı (cam kart içinde). Masaüstünde klavye rakamları, Backspace ve
 * Enter de çalışır (odak bir metin alanında değilken). Noktalar [data-scene-shake] taşır:
 * Scene.error() yanlışta onları sallar.
 */
export function PinPad({ length, onComplete, error, disabled, label = "PIN", onKey }: PinPadProps) {
  const [digits, setDigits] = useState("");
  const digitsRef = useRef("");

  const set = (v: string) => {
    digitsRef.current = v;
    setDigits(v);
  };
  const submit = (pin: string) => {
    if (pin.length === length) onComplete(pin);
  };
  const press = (d: string) => {
    if (disabled) return;
    // Dolu noktalar (gönderilmiş ya da hata sonrası sallanan) yeni tuşla sıfırlanır.
    const base = digitsRef.current.length >= length ? "" : digitsRef.current;
    const next = base + d;
    set(next);
    onKey?.("digit");
    if (next.length === length) submit(next);
  };
  const back = () => {
    if (disabled || !digitsRef.current) return;
    set(digitsRef.current.slice(0, -1));
    onKey?.("back");
  };

  // Gönderim bitti (disabled kalktı): dolu noktaları temizle; hata varsa sallanma görünsün diye kısa bekle.
  useEffect(() => {
    if (disabled || digits.length < length) return;
    const id = window.setTimeout(() => set(""), error ? 450 : 0);
    return () => window.clearTimeout(id);
  }, [disabled, error, length, digits]);

  const pressRef = useRef(press);
  const backRef = useRef(back);
  const submitRef = useRef(() => submit(digitsRef.current));
  useEffect(() => {
    pressRef.current = press;
    backRef.current = back;
    submitRef.current = () => submit(digitsRef.current);
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        pressRef.current(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        backRef.current();
      } else if (e.key === "Enter" && (!t || t.tagName !== "BUTTON")) {
        e.preventDefault();
        submitRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className={error ? `${s.pad} ${s.err}` : s.pad}>
      <div
        className={s.dots}
        role="img"
        aria-label={`${label}: ${digits.length} / ${length} hane girildi`}
        data-testid="pin-dots"
        data-scene-shake=""
      >
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
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7 6-7Z M12.5 9.5l5 5 M17.5 9.5l-5 5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
