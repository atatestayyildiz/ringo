"use client";

import { OperatorLogo } from "@/components/ui/OperatorLogo";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCustomersAction, reassignCustomersAction } from "@/app/(app)/musteriler/actions";
import { Avatar, Button, EmptyState, Modal, Select, StatusBadge, useToast, type CallStatus } from "@/components/ui";
import { IconUsers } from "@/components/icons";
import { formatPhone } from "@/lib/format";
import { CustomerSheet } from "./CustomerSheet";
import { memberName, STAGE_LABEL, type Customer, type MemberLite, type Viewer } from "./shared";
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
  const toast = useToast();
  const router = useRouter();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [transferOpen, setTransferOpen] = useState(false);
  const [to, setTo] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransfer] = useTransition();
  const allRef = useRef<HTMLInputElement>(null);

  const canSelect = viewer.canReassign || viewer.canDelete;
  // Yalnız görünen sayfadaki satırlar sayılır; sayfa veya filtre değişince eski seçim düşer.
  const picked = rows.filter((r) => checked.has(r.id));
  const allPicked = rows.length > 0 && picked.length === rows.length;
  // Seçimin tamamı atanmamışsa işlem "atama"dır (elle dağıtım akışı); metin buna göre değişir
  const assigning = picked.length > 0 && picked.every((r) => !r.assigned_to);

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = picked.length > 0 && !allPicked;
  }, [picked.length, allPicked]);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () => setChecked(allPicked ? new Set() : new Set(rows.map((r) => r.id)));

  const confirmTransfer = () => {
    if (!to || picked.length === 0) return;
    const ids = picked.map((r) => r.id);
    startTransfer(async () => {
      const res = await reassignCustomersAction(ids, to);
      if (res.ok) {
        toast(assigning ? `${res.moved} müşteri atandı` : `${res.moved} müşteri aktarıldı`);
        setChecked(new Set());
        setTransferOpen(false);
        setTo("");
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  };

  const confirmDelete = () => {
    if (picked.length === 0) return;
    const ids = picked.map((r) => r.id);
    startTransfer(async () => {
      const res = await deleteCustomersAction(ids);
      if (res.ok) {
        toast(`${res.deleted} müşteri silindi`);
        setChecked(new Set());
        setDeleteOpen(false);
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  };

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
      {canSelect ? (
        <label className="mu-selall">
          <input type="checkbox" ref={allRef} checked={allPicked} onChange={toggleAll} />
          <span>Sayfadakilerin tümünü seç ({rows.length})</span>
        </label>
      ) : null}
      <div className={`mu-colhead${canSelect ? " mu-colhead-sel" : ""}`} aria-hidden="true">
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
          const op = c.operator || "";
          const who = memberName(members, c.assigned_to);
          return (
            <li key={c.id} className={canSelect ? "mu-sel-li" : undefined}>
              {canSelect ? (
                <label className="mu-check">
                  <input
                    type="checkbox"
                    checked={checked.has(c.id)}
                    onChange={() => toggle(c.id)}
                    aria-label={`${c.full_name} seç`}
                  />
                </label>
              ) : null}
              <button type="button" className="mu-row" onClick={() => setSelectedId(c.id)} aria-label={`${c.full_name}, detay`}>
                <span className="mu-who">
                  <Avatar name={c.full_name} />
                  <span style={{ minWidth: 0 }}>
                    <b>{c.full_name}</b>
                    <span>{formatPhone(c.phone)}</span>
                  </span>
                </span>
                <span className="mu-cell mu-hide-m">{op ? <OperatorLogo operator={op} /> : "-"}</span>
                <span className="mu-st">
                  <StatusBadge status={c.call_status as CallStatus} />
                </span>
                <span className="mu-cell mu-hide-m">{stage || "-"}</span>
                <span className="mu-cell mu-hide-m">{who || "-"}</span>
                <span className="mu-note mu-hide-m">{c.last_note ?? ""}</span>
                <span className="mu-meta-m">
                  {op ? <span><OperatorLogo operator={op} /></span> : null}
                  {stage ? <span>{stage}</span> : null}
                  {who ? <span>{who}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {canSelect && picked.length > 0 ? (
        <div className="mu-bar" role="region" aria-label="Seçim işlemleri">
          <span className="mu-bar-count">{picked.length} seçili</span>
          <Button size="sm" variant="soft" onClick={() => setChecked(new Set())}>
            Temizle
          </Button>
          {viewer.canReassign ? (
            <Button size="sm" onClick={() => setTransferOpen(true)}>
              {assigning ? "Ata" : "Aktar"}
            </Button>
          ) : null}
          {viewer.canDelete ? (
            <Button size="sm" className="btn-danger" onClick={() => setDeleteOpen(true)}>
              Sil
            </Button>
          ) : null}
        </div>
      ) : null}
      <Modal open={transferOpen} onClose={() => (pending ? undefined : setTransferOpen(false))} title={assigning ? "Müşterileri ata" : "Müşterileri aktar"}>
        <p className="mu-confirm">
          {assigning
            ? `${picked.length} müşteri seçilen çalışana atanacak. Elle dağıtımda bugünkü listesine de eklenir.`
            : `${picked.length} müşteri seçilen çalışana aktarılacak. Bugünün listesindeki kayıtları da onun listesine geçer.`}
        </p>
        <Select label={assigning ? "Kime atansın" : "Kime aktarılsın"} value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Çalışan seçin</option>
          {members
            .filter((m) => m.is_active)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name}
              </option>
            ))}
        </Select>
        <div className="modal-foot">
          <Button variant="soft" onClick={() => setTransferOpen(false)} disabled={pending}>
            Vazgeç
          </Button>
          <Button variant="ink" onClick={confirmTransfer} disabled={pending || !to}>
            {pending ? (assigning ? "Atanıyor" : "Aktarılıyor") : assigning ? "Ata" : "Aktar"}
          </Button>
        </div>
      </Modal>
      <Modal open={deleteOpen} onClose={() => (pending ? undefined : setDeleteOpen(false))} title="Müşteriler silinsin mi?">
        <p className="mu-confirm">{picked.length} müşteri kalıcı olarak silinecek. Bu işlem geri alınamaz.</p>
        <div className="modal-foot">
          <Button variant="soft" onClick={() => setDeleteOpen(false)} disabled={pending}>
            Vazgeç
          </Button>
          <Button className="btn-danger-solid" onClick={confirmDelete} disabled={pending}>
            {pending ? "Siliniyor" : "Kalıcı olarak sil"}
          </Button>
        </div>
      </Modal>
      <CustomerSheet customer={selected} members={members} viewer={viewer} onClose={() => setSelectedId(null)} />
    </>
  );
}
