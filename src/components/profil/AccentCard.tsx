"use client";

import { useEffect, useState, useTransition } from "react";
import { setAccentAction } from "@/app/(app)/profil/actions";
import { Card, useToast } from "@/components/ui";
import s from "./profil.module.css";

/** Hazır vurgu renkleri: beyaz metinle en az 4.5:1, koyu zeminde en az 3:1. */
export const ACCENT_SWATCHES = [
  { name: "Mavi", hex: "#2563eb" },
  { name: "Okyanus", hex: "#0369a1" },
  { name: "Turkuaz", hex: "#0e7490" },
  { name: "Zümrüt", hex: "#0f766e" },
  { name: "Yeşil", hex: "#15803d" },
  { name: "Kehribar", hex: "#b45309" },
  { name: "Turuncu", hex: "#c2410c" },
  { name: "Kırmızı", hex: "#dc2626" },
  { name: "Pembe", hex: "#db2777" },
  { name: "Mor", hex: "#7c3aed" },
] as const;

const HEX = /^#[0-9a-fA-F]{6}$/;

function applyPreview(value: string | null) {
  const root = document.documentElement.style;
  if (value) root.setProperty("--brand", value);
  else root.removeProperty("--brand");
}

export function AccentCard({
  current,
  brandColor,
  isManager,
}: {
  current: string | null;
  brandColor: string;
  isManager: boolean;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [color, setColor] = useState<string | null>(current ? current.toLowerCase() : null);

  const brand = HEX.test(brandColor) ? brandColor.toLowerCase() : null;
  const defaultCss = isManager ? brand : "var(--accent-neutral)";

  // Sayfadan çıkınca canlı önizlemeyi kaldır; kalıcı renk düzen bileşeninden gelir.
  useEffect(() => () => applyPreview(null), []);

  const choose = (next: string | null) => {
    if (pending || next === color) return;
    const prev = color;
    setColor(next);
    applyPreview(next ?? defaultCss);
    start(async () => {
      const res = await setAccentAction(next);
      if (!res.ok) {
        setColor(prev);
        applyPreview(prev ?? defaultCss);
        toast(res.error, "error");
        return;
      }
      toast(next === null ? "Varsayılan renge dönüldü." : "Arayüz rengi kaydedildi.");
    });
  };

  const storeChecked = brand !== null && color === brand;

  return (
    <Card>
      <h2 id="accent-title">Arayüz rengi</h2>
      <p className={s.sub}>Butonlar ve vurgular bu renkte görünür. Seçimin tüm cihazlarında geçerli.</p>
      <div role="radiogroup" aria-labelledby="accent-title" className={s.accent} aria-busy={pending}>
        <label className={s.accentWide}>
          <input
            type="radio"
            name="accent"
            className={s.accentInput}
            aria-label="Varsayılan"
            checked={color === null}
            onChange={() => choose(null)}
          />
          <span className={s.dot} style={{ background: defaultCss ?? "var(--ink-3)" }} aria-hidden="true" />
          <span>
            Varsayılan
            <small>{isManager ? "Mağaza rengi" : "Nötr arduvaz"}</small>
          </span>
        </label>
        {brand ? (
          <label className={s.accentWide}>
            <input
              type="radio"
              name="accent"
              className={s.accentInput}
              aria-label="Mağaza rengi"
              checked={storeChecked}
              onChange={() => choose(brand)}
            />
            <span className={s.dot} style={{ background: brand }} aria-hidden="true" />
            <span>Mağaza rengi</span>
          </label>
        ) : null}
        <div className={s.swatches}>
          {ACCENT_SWATCHES.map((sw) => (
            <label key={sw.hex} className={s.swatch} title={sw.name}>
              <input
                type="radio"
                name="accent"
                className={s.accentInput}
                aria-label={sw.name}
                checked={!storeChecked && color === sw.hex}
                onChange={() => choose(sw.hex)}
              />
              <span className={s.dot} style={{ background: sw.hex }} aria-hidden="true" />
            </label>
          ))}
        </div>
      </div>
    </Card>
  );
}
