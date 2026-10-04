"use client";

import { useState } from "react";
import { Button, Input, Modal, Textarea } from "@/components/ui";
import { dayKey } from "@/lib/format";
import styles from "./bugun.module.css";

const TZ = "Europe/Istanbul";

/** Europe/Istanbul duvar saati, datetime-local biçiminde (YYYY-MM-DDTHH:mm). */
function toLocalInput(d: Date): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

/** Türkiye UTC+3 sabit; girilen duvar saatini Istanbul saati olarak yorumlar. */
function fromLocalInput(v: string): Date {
  return new Date(`${v}:00+03:00`);
}

export function CallbackDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (at: Date) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Ne zaman aransın?">
      {open ? <CallbackForm onClose={onClose} onConfirm={onConfirm} /> : null}
    </Modal>
  );
}

function CallbackForm({ onClose, onConfirm }: { onClose: () => void; onConfirm: (at: Date) => void }) {
  const [value, setValue] = useState(() => `${dayKey(Date.now() + 86_400_000)}T10:00`);
  const [error, setError] = useState<string | undefined>();
  const min = toLocalInput(new Date());

  function submit() {
    const d = fromLocalInput(value);
    if (!value || Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) {
      setError("Geçmiş bir zaman seçilemez. Gelecekte bir tarih ve saat seçin.");
      return;
    }
    onConfirm(d);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Input
        label="Tarih ve saat"
        type="datetime-local"
        value={value}
        min={min}
        required
        data-autofocus
        error={error}
        onChange={(e) => {
          setValue(e.target.value);
          setError(undefined);
        }}
      />
      <div className={styles.quick}>
        <button type="button" onClick={() => setValue(toLocalInput(new Date(Date.now() + 3_600_000)))}>
          1 saat sonra
        </button>
        <button type="button" onClick={() => setValue(`${dayKey(Date.now() + 86_400_000)}T10:00`)}>
          Yarın 10:00
        </button>
        <button type="button" onClick={() => setValue(`${dayKey(Date.now() + 3 * 86_400_000)}T10:00`)}>
          3 gün sonra
        </button>
      </div>
      <div className="modal-foot">
        <Button variant="soft" onClick={onClose}>
          Vazgeç
        </Button>
        <Button type="submit" variant="brand">
          Kaydet
        </Button>
      </div>
    </form>
  );
}

export function ReasonDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Neden uygun değil?">
      {open ? <ReasonForm onClose={onClose} onConfirm={onConfirm} /> : null}
    </Modal>
  );
}

function ReasonForm({ onClose, onConfirm }: { onClose: () => void; onConfirm: (reason: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const v = value.trim();
        if (!v) {
          setError("Nedeni kısaca yazın. Örnek: icra kaydı var.");
          return;
        }
        onConfirm(v);
      }}
    >
      <Textarea
        label="Neden"
        placeholder="İcra kaydı, kredi puanı düşük…"
        rows={3}
        maxLength={500}
        value={value}
        data-autofocus
        error={error}
        onChange={(e) => {
          setValue(e.target.value);
          setError(undefined);
        }}
      />
      <div className="modal-foot">
        <Button variant="soft" onClick={onClose}>
          Vazgeç
        </Button>
        <Button type="submit" variant="brand">
          Kaydet
        </Button>
      </div>
    </form>
  );
}
