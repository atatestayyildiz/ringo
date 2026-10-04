"use client";

import { useEffect, useRef } from "react";
import { useToast } from "@/components/ui";

/** Şifre yenilendikten sonra girişte kısa bildirim gösterir (bir kez). */
export function ResetFlash({ show }: { show: boolean }) {
  const toast = useToast();
  const shown = useRef(false);
  useEffect(() => {
    if (show && !shown.current) {
      shown.current = true;
      toast("Şifren değişti. Yeni şifrenle giriş yapabilirsin.");
    }
  }, [show, toast]);
  return null;
}
