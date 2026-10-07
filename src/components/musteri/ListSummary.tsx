"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { deleteAllCustomersAction } from "@/app/(app)/musteriler/actions";
import { Button, Input, Modal, SelectBase, useToast } from "@/components/ui";
import "./musteri.css";

const fmt = (n: number) => n.toLocaleString("tr-TR");

/** Liste üstü: toplam / filtreye uyan / gösterilen aralık, sayfa başına adet seçici, yöneticiye "Tümünü sil". */
export function ListSummary({
  total,
  allTotal,
  from,
  shown,
  filtered,
  pageSize,
  pageSizes,
  canDeleteAll,
}: {
  total: number;
  allTotal: number;
  from: number;
  shown: number;
  filtered: boolean;
  pageSize: number;
  pageSizes: number[];
  canDeleteAll: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();

  const setSize = (v: string) => {
    const next = new URLSearchParams(params.toString());
    if (v && Number(v) !== pageSizes[0]) next.set("adet", v);
    else next.delete("adet");
    next.delete("sayfa");
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname);
  };

  const confirmDeleteAll = () => {
    start(async () => {
      const res = await deleteAllCustomersAction(allTotal);
      if (res.ok) {
        toast(`${fmt(res.deleted)} müşteri silindi`);
        setOpen(false);
        setTyped("");
        router.replace(pathname);
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  };

  const range = shown > 0 ? `${fmt(from + 1)}-${fmt(from + shown)} arası gösteriliyor` : "";

  return (
    <div className="mu-count">
      <p className="mu-count-text" data-testid="mu-count">
        {filtered ? (
          <>
            <b>{fmt(allTotal)}</b> müşteriden <b>{fmt(total)}</b> tanesi filtreye uyuyor
          </>
        ) : (
          <>
            Toplam <b>{fmt(total)}</b> müşteri
          </>
        )}
        {range ? <span> · {range}</span> : null}
      </p>
      <div className="mu-count-ctl">
        <SelectBase aria-label="Sayfa başına müşteri" value={String(pageSize)} onChange={(e) => setSize(e.target.value)}>
          {pageSizes.map((n) => (
            <option key={n} value={n}>
              Sayfa başına {n}
            </option>
          ))}
        </SelectBase>
        {canDeleteAll && allTotal > 0 ? (
          <Button size="sm" className="btn-danger" onClick={() => setOpen(true)}>
            Tümünü sil
          </Button>
        ) : null}
      </div>
      <Modal open={open} onClose={() => (pending ? undefined : setOpen(false))} title="Tüm müşteriler silinsin mi?">
        <p className="mu-confirm">
          Filtre ne olursa olsun sistemdeki <b>{fmt(allTotal)}</b> müşterinin tamamı; arama geçmişi, huni ve randevu kayıtlarıyla
          birlikte kalıcı olarak silinecek. Bu işlem geri alınamaz.
        </p>
        <Input
          label={`Onaylamak için ${fmt(allTotal)} yazın`}
          value={typed}
          inputMode="numeric"
          autoComplete="off"
          onChange={(e) => setTyped(e.target.value)}
        />
        <div className="modal-foot">
          <Button variant="soft" onClick={() => setOpen(false)} disabled={pending}>
            Vazgeç
          </Button>
          <Button
            className="btn-danger-solid"
            onClick={confirmDeleteAll}
            disabled={pending || typed.replace(/\D/g, "") !== String(allTotal)}
          >
            {pending ? "Siliniyor" : "Hepsini kalıcı olarak sil"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
