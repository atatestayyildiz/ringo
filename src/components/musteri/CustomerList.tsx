"use client";

import { useState } from "react";
import { Avatar, EmptyState, StatusBadge, type CallStatus } from "@/components/ui";
import { IconUsers } from "@/components/icons";
import { formatPhone } from "@/lib/format";
import { CustomerSheet } from "./CustomerSheet";
import { memberName, OPERATOR_LABEL, STAGE_LABEL, type Customer, type MemberLite, type Viewer } from "./shared";
import "./musteri.css";

export function CustomerList({
  rows,
  members,
  viewer,
  filtered,
  total,
}: {
  rows: Customer[];
  members: MemberLite[];
  viewer: Viewer;
  filtered: boolean;
  total: number;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  if (rows.length === 0) {
    return (
      <EmptyState title={filtered ? "Aramayla eşleşen müşteri yok" : "Henüz müşteri yok"} icon={<IconUsers />}>
        {filtered
          ? "Arama ve filtreleri değiştirip tekrar deneyin."
          : viewer.canImport
            ? "Müşteri ekleyin veya Excel dosyasından içe aktarın."
            : "Yönetici dağıtım yapınca sana atanan müşteriler burada görünür."}
      </EmptyState>
    );
  }

  return (
    <>
      <div className="mu-colhead" aria-hidden="true">
        <span>Müşteri</span>
        <span>Operatör</span>
        <span>Durum</span>
        <span>Aşama</span>
        <span>Atanan</span>
        <span>Son not</span>
      </div>
      <ul className="mu-list" aria-label={`Müşteri listesi, toplam ${total}`}>
        {rows.map((c) => {
          const stage = c.pipeline_stage ? STAGE_LABEL[c.pipeline_stage] : "";
          const op = c.operator ? OPERATOR_LABEL[c.operator] : "";
          const who = memberName(members, c.assigned_to);
          return (
            <li key={c.id}>
              <button type="button" className="mu-row" onClick={() => setSelectedId(c.id)} aria-label={`${c.full_name}, detay`}>
                <span className="mu-who">
                  <Avatar name={c.full_name} />
                  <span style={{ minWidth: 0 }}>
                    <b>{c.full_name}</b>
                    <span>{formatPhone(c.phone)}</span>
                  </span>
                </span>
                <span className="mu-cell mu-hide-m">{op || "-"}</span>
                <span className="mu-st">
                  <StatusBadge status={c.call_status as CallStatus} />
                </span>
                <span className="mu-cell mu-hide-m">{stage || "-"}</span>
                <span className="mu-cell mu-hide-m">{who || "-"}</span>
                <span className="mu-note mu-hide-m">{c.last_note ?? ""}</span>
                <span className="mu-meta-m">
                  {op ? <span>{op}</span> : null}
                  {stage ? <span>{stage}</span> : null}
                  {who ? <span>{who}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <CustomerSheet customer={selected} members={members} viewer={viewer} onClose={() => setSelectedId(null)} />
    </>
  );
}
