"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

type Kind = "info" | "error";
type Item = { id: number; message: string; kind: Kind };
type ToastApi = { toast: (message: string, kind?: Kind) => void };

const Ctx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const seq = useRef(0);

  const toast = useCallback((message: string, kind: Kind = "info") => {
    const id = ++seq.current;
    setItems((l) => [...l, { id, message, kind }]);
    setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), kind === "error" ? 5000 : 2800);
  }, []);

  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast" data-kind={t.kind}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi["toast"] {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast, ToastProvider içinde kullanılmalı.");
  return c.toast;
}
