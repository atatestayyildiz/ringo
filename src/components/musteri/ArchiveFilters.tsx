"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SelectBase } from "@/components/ui";
import { ARCHIVE_OUTCOMES, OPERATOR_LABEL } from "./shared";
import "./musteri.css";

/** Geçmiş dönem listesi filtreleri: arama (ad, telefon, not), son sonuç, son işlem tarih aralığı, operatör, sıralama. Durum URL'de. */
export function ArchiveFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("sayfa");
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname);
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onSearch = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => push({ q: v.trim() }), 350);
  };

  const sel = (name: string) => params.get(name) ?? "";
  const hasFilter = ["q", "sonuc", "bas", "bit", "operator", "sira"].some((k) => params.get(k));

  return (
    <div className="ar-tools" role="search">
      <input
        className="input ar-q"
        type="search"
        value={q}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Ad, telefon ya da not ara (ör. icra)"
        aria-label="Ad, telefon ya da not ara"
        enterKeyHint="search"
      />
      <SelectBase aria-label="Son sonuç" className={sel("sonuc") ? "is-set" : undefined} value={sel("sonuc")} onChange={(e) => push({ sonuc: e.target.value })}>
        <option value="">Tüm sonuçlar</option>
        {ARCHIVE_OUTCOMES.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </SelectBase>
      <SelectBase aria-label="Operatör" className={sel("operator") ? "is-set" : undefined} value={sel("operator")} onChange={(e) => push({ operator: e.target.value })}>
        <option value="">Tüm operatörler</option>
        {Object.entries(OPERATOR_LABEL).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
        <option value="yok">Operatör yok</option>
      </SelectBase>
      <label className="ar-date">
        <span>Son işlem, başlangıç</span>
        <input className="input" type="date" value={sel("bas")} max={sel("bit") || undefined} onChange={(e) => push({ bas: e.target.value })} aria-label="Son işlem başlangıç tarihi" />
      </label>
      <label className="ar-date">
        <span>Son işlem, bitiş</span>
        <input className="input" type="date" value={sel("bit")} min={sel("bas") || undefined} onChange={(e) => push({ bit: e.target.value })} aria-label="Son işlem bitiş tarihi" />
      </label>
      <SelectBase aria-label="Sıralama" className={sel("sira") ? "is-set" : undefined} value={sel("sira")} onChange={(e) => push({ sira: e.target.value })}>
        <option value="">Önce en yeni kapanan</option>
        <option value="eski">Önce en eski kapanan</option>
        <option value="ad">Ada göre</option>
      </SelectBase>
      {hasFilter ? (
        <button
          type="button"
          className="ar-clear"
          onClick={() => {
            setQ("");
            router.replace(pathname);
          }}
        >
          Filtreleri temizle
        </button>
      ) : null}
    </div>
  );
}
