"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui";
import { AddCustomerModal } from "./AddCustomerButton";
import "./musteri.css";

/**
 * Müşteriler başlığındaki tek düğme: üzerine gelince (dokunmatikte basınca) yana açılan menü.
 * Müşteri ekle, Excel içe aktar ve Dışa aktar burada toplanır; yetkisiz olanlar görünmez.
 */
export function CustomerActions({ canImport, exportHref }: { canImport: boolean; exportHref: string | null }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const enter = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    if (timer.current) clearTimeout(timer.current);
    setOpen(true);
  };
  const leave = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 180);
  };

  if (!canImport && !exportHref) return null;

  return (
    <>
      <div className="mu-actmenu" ref={ref} onPointerEnter={enter} onPointerLeave={leave}>
        <button
          type="button"
          className={buttonClass("ink")}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          Müşteri işlemleri
          <span className="mu-actmenu-caret" aria-hidden="true">
            ‹
          </span>
        </button>
        {open ? (
          <div className="mu-actmenu-list" role="menu">
            {canImport ? (
              <button
                type="button"
                role="menuitem"
                className={buttonClass("soft")}
                onClick={() => {
                  setOpen(false);
                  setAdding(true);
                }}
              >
                Müşteri ekle
              </button>
            ) : null}
            {canImport ? (
              <Link href="/musteriler/ice-aktar" role="menuitem" className={buttonClass("soft")}>
                Excel içe aktar
              </Link>
            ) : null}
            {exportHref ? (
              <a href={exportHref} role="menuitem" className={buttonClass("soft")} download>
                Dışa aktar
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
      {adding ? <AddCustomerModal onClose={() => setAdding(false)} /> : null}
    </>
  );
}
