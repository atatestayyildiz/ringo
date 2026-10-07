"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Modal, Select, useToast } from "@/components/ui";
import { dayKey } from "@/lib/format";
import { normalizeTrPhone } from "@/lib/import/phone";
import { createClient } from "@/lib/supabase/client";
import { OPERATOR_LABEL } from "./shared";
import "./musteri.css";
import { toUserMessage } from "@/lib/errors";

type Result = { inserted: number; duplicates: number; reopened?: number; invalid: number; invalid_rows: { index: number; reason: string }[] };

export function AddCustomerButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Müşteri ekle</Button>
      {open ? <AddModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function AddModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [operator, setOperator] = useState("");
  const [birth, setBirth] = useState("");
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<{ name?: string; phone?: string }>({});

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.replace(/\s+/g, " ").trim();
    const next: typeof errs = {};
    if (!n) next.name = "Ad soyad boş olamaz.";
    if (!normalizeTrPhone(phone)) next.phone = "Geçerli bir cep numarası girin. Örnek: 0532 123 45 67";
    setErrs(next);
    if (next.name || next.phone) return;

    setBusy(true);
    // Normalize ve mükerrer kontrolü import_customers içinde tek yerden geçer
    const { data, error } = await createClient().rpc("import_customers", {
      p_rows: [
        {
          full_name: n,
          phone,
          ...(operator ? { operator } : {}),
          ...(birth ? { birth_date: birth } : {}),
        },
      ],
      p_source_detail: "Elle eklendi",
    });
    setBusy(false);
    if (error) {
      toast(toUserMessage(error), "error");
      return;
    }
    const r = data as unknown as Result;
    if (r.duplicates > 0) {
      setErrs({ phone: "Bu numara zaten kayıtlı." });
      return;
    }
    if (r.inserted < 1) {
      setErrs({ phone: r.invalid_rows[0]?.reason ?? "Müşteri eklenemedi." });
      return;
    }
    toast("Müşteri eklendi. Bir sonraki dağıtımda listeye girer.");
    onClose();
    router.refresh();
  };

  return (
    <Modal open onClose={onClose} title="Müşteri ekle">
      <form className="mu-form" onSubmit={submit} noValidate>
        <Input label="Ad soyad" value={name} onChange={(e) => setName(e.target.value)} error={errs.name} data-autofocus required />
        <Input
          label="Telefon"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={errs.phone}
          inputMode="tel"
          placeholder="0532 123 45 67"
          required
        />
        <Select label="Operatör (isteğe bağlı)" value={operator} onChange={(e) => setOperator(e.target.value)}>
          <option value="">Belirtilmemiş</option>
          {Object.entries(OPERATOR_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Input
          label="Doğum tarihi (isteğe bağlı)"
          type="date"
          value={birth}
          max={dayKey(new Date())}
          onChange={(e) => setBirth(e.target.value)}
        />
        <div className="modal-foot">
          <Button variant="soft" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Ekleniyor" : "Ekle"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
