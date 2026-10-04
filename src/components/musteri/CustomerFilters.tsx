"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { STATUS_INFO } from "@/components/ui";
import { ALL_STAGES, OPERATOR_LABEL, STAGE_LABEL, type MemberLite } from "./shared";
import "./musteri.css";

export function CustomerFilters({ members }: { members: MemberLite[] }) {
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

  return (
    <div className="mu-tools" role="search">
      <input
        className="input"
        type="search"
        value={q}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Ad veya telefon ara"
        aria-label="Ad veya telefon ara"
        enterKeyHint="search"
      />
      <select className="input" aria-label="Durum" value={sel("durum")} onChange={(e) => push({ durum: e.target.value })}>
        <option value="">Tüm durumlar</option>
        {Object.entries(STATUS_INFO).map(([k, v]) => (
          <option key={k} value={k}>
            {v.label}
          </option>
        ))}
      </select>
      <select className="input" aria-label="Huni aşaması" value={sel("asama")} onChange={(e) => push({ asama: e.target.value })}>
        <option value="">Tüm aşamalar</option>
        <option value="yok">Aşaması yok</option>
        {ALL_STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABEL[s]}
          </option>
        ))}
      </select>
      <select className="input" aria-label="Operatör" value={sel("operator")} onChange={(e) => push({ operator: e.target.value })}>
        <option value="">Tüm operatörler</option>
        {Object.entries(OPERATOR_LABEL).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
        <option value="yok">Operatör yok</option>
      </select>
      <select className="input" aria-label="Atanan çalışan" value={sel("atanan")} onChange={(e) => push({ atanan: e.target.value })}>
        <option value="">Tüm çalışanlar</option>
        <option value="yok">Atanmamış</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.full_name}
          </option>
        ))}
      </select>
    </div>
  );
}
