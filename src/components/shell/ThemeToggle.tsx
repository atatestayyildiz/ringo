"use client";

import { useSyncExternalStore } from "react";
import { IconMoon, IconSun } from "@/components/icons";
import { RoundButton } from "@/components/ui";

function isDark(): boolean {
  const t = document.documentElement.dataset.theme;
  return t === "dark" || (!t && matchMedia("(prefers-color-scheme: dark)").matches);
}

function subscribe(cb: () => void) {
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  mq.addEventListener("change", cb);
  return () => {
    mo.disconnect();
    mq.removeEventListener("change", cb);
  };
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  const toggle = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // depolama kapalı olabilir
    }
  };
  return (
    <RoundButton label={dark ? "Açık temaya geç" : "Koyu temaya geç"} onClick={toggle} aria-pressed={dark}>
      {dark ? <IconSun /> : <IconMoon />}
    </RoundButton>
  );
}
