"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Sahne alt bölmesi açıkken (giriş kartı, PIN daireleri) dışarıya tıklama/dokunma ya da Escape kapatır.
 * Dış tıklama belge düzeyinde, yakalama evresinde tüketilir: altındaki neon akışa ulaşmaz (renk karışmaz)
 * ve başka bir öğeyi tetiklemez; yalnız kapatır.
 */
export function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, onClose: () => void, disabled = false) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open || disabled) return;
    // İçerisi: bölmenin kendisi ya da sahnedeki başka bir denetim (bağlantı, düğme); onlar kendi işini yapar.
    const inside = (t: EventTarget | null) =>
      t instanceof Element && (Boolean(ref.current?.contains(t)) || Boolean(t.closest("a,button,input,textarea,select,label,[role=button]")));
    // pointerdown dışarıda başlayıp tıklama dışarıda biterse kapat (içeriden sürükleyip dışarıda bırakmak kapatmaz).
    let downOutside = false;
    const onDown = (e: PointerEvent) => {
      downOutside = !inside(e.target);
    };
    const onClick = (e: MouseEvent) => {
      if (!downOutside || inside(e.target)) return;
      downOutside = false;
      e.stopPropagation();
      e.preventDefault();
      closeRef.current();
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open, disabled, ref]);
}
