"use client";

import { useState } from "react";
import { Button, Input, Modal, useToast } from "@/components/ui";
import { trimTime } from "@/lib/appointment";
import { toUserMessage } from "@/lib/errors";
import { dayKey } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import "./musteri.css";

export type AppointmentValue = {
  /** YYYY-MM-DD, null = belli değil */
  day: string | null;
  /** HH:MM, null = saat yok */
  time: string | null;
};

type Mode = "today" | "tomorrow" | "date" | "unknown";

export function AppointmentDialog({
  open,
  onClose,
  onConfirm,
  initial,
  title = "Ne zaman gelecek?",
  busy = false,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (v: AppointmentValue) => void;
  /** Değiştirme akışında mevcut zaman; verilmezse Yarın seçili açılır */
  initial?: AppointmentValue;
  title?: string;
  busy?: boolean;
  /** Sunucudan dönen hata (pencere açık kalır) */
  error?: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {open ? <Form onClose={onClose} onConfirm={onConfirm} initial={initial} busy={busy} error={error} /> : null}
    </Modal>
  );
}

function initialMode(initial: AppointmentValue | undefined, today: string, tomorrow: string): Mode {
  if (!initial) return "tomorrow";
  if (!initial.day) return "unknown";
  if (initial.day === today) return "today";
  if (initial.day === tomorrow) return "tomorrow";
  return "date";
}

function Form({
  onClose,
  onConfirm,
  initial,
  busy,
  error,
}: {
  onClose: () => void;
  onConfirm: (v: AppointmentValue) => void;
  initial?: AppointmentValue;
  busy: boolean;
  error?: string;
}) {
  // Pencere açıldığındaki gün; açıkken değişmez
  const [{ today, tomorrow }] = useState(() => ({
    today: dayKey(Date.now()),
    tomorrow: dayKey(Date.now() + 86_400_000),
  }));
  const [mode, setMode] = useState<Mode>(() => initialMode(initial, today, tomorrow));
  const [date, setDate] = useState(initial?.day && initial.day >= today ? initial.day : tomorrow);
  const [time, setTime] = useState(trimTime(initial?.time) ?? "");
  const [localError, setLocalError] = useState<string | undefined>();

  function submit() {
    if (mode === "unknown") return onConfirm({ day: null, time: null });
    const day = mode === "today" ? today : mode === "tomorrow" ? tomorrow : date;
    if (!day || day < today) {
      setLocalError("Geçmiş bir gün seçilemez. Bugün veya sonrası bir tarih seçin.");
      return;
    }
    onConfirm({ day, time: time || null });
  }

  const chip = (m: Mode, label: string, autofocus = false) => (
    <button
      type="button"
      className="mu-ap-chip"
      aria-pressed={mode === m}
      data-autofocus={autofocus ? "" : undefined}
      onClick={() => {
        setMode(m);
        setLocalError(undefined);
      }}
    >
      {label}
    </button>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="mu-ap-chips" role="group" aria-label="Gün">
        {chip("today", "Bugün", true)}
        {chip("tomorrow", "Yarın")}
        {chip("date", "Tarih seç")}
      </div>
      {mode === "date" ? (
        <Input
          label="Tarih"
          type="date"
          value={date}
          min={today}
          required
          onChange={(e) => {
            setDate(e.target.value);
            setLocalError(undefined);
          }}
        />
      ) : null}
      {mode !== "unknown" ? (
        <Input
          label="Saat (isteğe bağlı)"
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
      ) : null}
      <div className="mu-ap-chips">{chip("unknown", "Belli değil, uğrayacak")}</div>
      {localError || error ? (
        <div className="form-error" role="alert">
          {localError ?? error}
        </div>
      ) : null}
      <div className="modal-foot">
        <Button variant="soft" onClick={onClose}>
          Vazgeç
        </Button>
        <Button type="submit" variant="brand" disabled={busy}>
          Kaydet
        </Button>
      </div>
    </form>
  );
}

/** Randevu aşamasındaki müşterinin zamanını set_appointment ile değiştirir (Huni ve müşteri detayı). */
export function ChangeAppointmentDialog({
  open,
  customerId,
  initial,
  onClose,
  onDone,
}: {
  open: boolean;
  customerId: string;
  initial: AppointmentValue;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function save(v: AppointmentValue) {
    setBusy(true);
    setError(undefined);
    const { error: err } = await createClient().rpc("set_appointment", {
      p_customer: customerId,
      p_day: v.day ?? undefined,
      p_time: v.day ? (v.time ?? undefined) : undefined,
    });
    setBusy(false);
    if (err) {
      setError(toUserMessage(err));
      return;
    }
    toast("Randevu zamanı kaydedildi");
    onDone();
  }

  return (
    <AppointmentDialog
      open={open}
      onClose={onClose}
      onConfirm={save}
      initial={initial}
      title="Randevu zamanını değiştir"
      busy={busy}
      error={error}
    />
  );
}
