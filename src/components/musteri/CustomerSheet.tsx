"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Avatar,
  Button,
  ButtonLink,
  Input,
  Modal,
  Select,
  Sheet,
  StatusBadge,
  Textarea,
  useToast,
  type CallStatus,
} from "@/components/ui";
import { IconPhone } from "@/components/icons";
import { dayKey, formatDate, formatDateTime, formatPhone, telLink } from "@/lib/format";
import { normalizeTrPhone } from "@/lib/import/phone";
import { createClient } from "@/lib/supabase/client";
import {
  ALL_STAGES,
  memberName,
  OPERATOR_LABEL,
  OUTCOME_LABEL,
  STAGE_LABEL,
  type Customer,
  type MemberLite,
  type Viewer,
} from "./shared";
import "./musteri.css";

type Props = {
  customer: Customer | null;
  members: MemberLite[];
  viewer: Viewer;
  onClose: () => void;
};

export function CustomerSheet({ customer, members, viewer, onClose }: Props) {
  return (
    <Sheet open={customer !== null} onClose={onClose} title="Müşteri detayı">
      {customer ? <Body key={customer.id} customer={customer} members={members} viewer={viewer} onClose={onClose} /> : null}
    </Sheet>
  );
}

function daysToBirthday(iso: string): number {
  const today = dayKey(new Date());
  const [ty, tm, td] = today.split("-").map(Number);
  const [, bm, bd] = iso.split("-").map(Number);
  const todayUtc = Date.UTC(ty, tm - 1, td);
  const inYear = (y: number) => {
    // 29 Şubat, 28 Şubat sayılır (spec §5)
    const leap = new Date(Date.UTC(y, 2, 0)).getUTCDate() === 29;
    return Date.UTC(y, bm - 1, bm === 2 && bd === 29 && !leap ? 28 : bd);
  };
  let t = inYear(ty);
  if (t < todayUtc) t = inYear(ty + 1);
  return Math.round((t - todayUtc) / 86_400_000);
}

function Body({
  customer: c,
  members,
  viewer,
  onClose,
}: Props & { customer: Customer }) {
  const router = useRouter();
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const canStage = viewer.isManager || c.assigned_to === viewer.id;
  const activeMembers = members.filter((m) => m.is_active);
  const tel = telLink(c.phone);

  const refresh = () => {
    setVersion((v) => v + 1);
    router.refresh();
  };

  return (
    <>
      <div className="mu-hero">
        <Avatar name={c.full_name} />
        <div style={{ minWidth: 0 }}>
          <b>{c.full_name}</b>
          <span>{formatPhone(c.phone)}</span>
          <div className="mu-badges">
            <StatusBadge status={c.call_status as CallStatus} />
            {c.pipeline_stage ? <span className="chip">{STAGE_LABEL[c.pipeline_stage]}</span> : null}
          </div>
        </div>
      </div>
      {tel ? (
        <div style={{ marginTop: 14 }}>
          <ButtonLink href={tel} variant="brand" size="sm">
            <IconPhone /> Ara
          </ButtonLink>
        </div>
      ) : null}

      <section className="mu-sec">
        <h3>
          Bilgiler
          {viewer.isManager && !editing ? (
            <Button variant="soft" size="sm" onClick={() => setEditing(true)}>
              Düzenle
            </Button>
          ) : null}
        </h3>
        {editing ? (
          <EditForm
            customer={c}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              refresh();
            }}
          />
        ) : (
          <dl className="mu-kv">
            <div>
              <dt>Telefon</dt>
              <dd>{formatPhone(c.phone)}</dd>
            </div>
            {c.phone_alt ? (
              <div>
                <dt>İkinci telefon</dt>
                <dd>{formatPhone(c.phone_alt)}</dd>
              </div>
            ) : null}
            <div>
              <dt>Operatör</dt>
              <dd>{c.operator ? OPERATOR_LABEL[c.operator] : "-"}</dd>
            </div>
            <div>
              <dt>Doğum tarihi</dt>
              <dd>
                {c.birth_date ? (
                  <>
                    {formatDate(`${c.birth_date}T12:00:00+03:00`)}
                    <small style={{ display: "block", color: "var(--ink-3)", fontWeight: 500 }}>
                      {(() => {
                        const n = daysToBirthday(c.birth_date);
                        return n === 0 ? "Doğum günü bugün" : `Doğum gününe ${n} gün`;
                      })()}
                    </small>
                  </>
                ) : (
                  "-"
                )}
              </dd>
            </div>
            <div>
              <dt>Kaynak</dt>
              <dd>{c.source_detail || (c.source === "manual" ? "Elle eklendi" : c.source === "import" ? "İçe aktarıldı" : "Meta")}</dd>
            </div>
            {c.applied_at ? (
              <div>
                <dt>Başvuru zamanı</dt>
                <dd>{formatDateTime(c.applied_at)}</dd>
              </div>
            ) : null}
            <div>
              <dt>Atanan</dt>
              <dd>{memberName(members, c.assigned_to) || "-"}</dd>
            </div>
            <div>
              <dt>Deneme</dt>
              <dd>
                {c.attempts_in_round} bu turda, havuza {c.pool_count} kez düştü
              </dd>
            </div>
          </dl>
        )}
      </section>

      <section className="mu-sec">
        <h3>Huni aşaması</h3>
        {canStage ? (
          <StageForm customer={c} onDone={refresh} />
        ) : (
          <p className="mu-warn">
            {c.pipeline_stage ? `Aşama: ${STAGE_LABEL[c.pipeline_stage]}. ` : "Aşama henüz yok. "}
            Aşamayı yalnız yönetici veya müşterinin atandığı çalışan değiştirebilir.
          </p>
        )}
      </section>

      {viewer.isManager || viewer.canReassign ? (
        <section className="mu-sec">
          <h3>Devret</h3>
          <ReassignForm customer={c} members={activeMembers} onDone={refresh} />
        </section>
      ) : null}

      <section className="mu-sec">
        <h3>Geçmiş</h3>
        <Timeline key={version} customerId={c.id} members={members} />
      </section>

      {viewer.isManager || viewer.canDelete ? (
        <div className="mu-danger">
          <Button variant="soft" className="btn-danger" onClick={() => setConfirmDelete(true)}>
            Müşteriyi sil
          </Button>
        </div>
      ) : null}

      <DeleteModal
        open={confirmDelete}
        customer={c}
        onClose={() => setConfirmDelete(false)}
        onDeleted={() => {
          setConfirmDelete(false);
          onClose();
          router.refresh();
          toast("Müşteri silindi");
        }}
      />
    </>
  );
}

/* ---------- düzenle (yalnız yönetici; customers update RLS) ---------- */
function EditForm({ customer: c, onCancel, onSaved }: { customer: Customer; onCancel: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(c.full_name);
  const [phone, setPhone] = useState(formatPhone(c.phone));
  const [operator, setOperator] = useState(c.operator ?? "");
  const [birth, setBirth] = useState(c.birth_date ?? "");
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<{ name?: string; phone?: string }>({});

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.replace(/\s+/g, " ").trim();
    const p = normalizeTrPhone(phone);
    const next: typeof errs = {};
    if (!n) next.name = "Ad soyad boş olamaz.";
    if (!p) next.phone = "Geçerli bir cep numarası girin. Örnek: 0532 123 45 67";
    setErrs(next);
    if (next.name || next.phone || !p) return;

    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("customers")
      .update({
        full_name: n,
        phone: p,
        operator: operator || null,
        birth_date: birth || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", c.id)
      .select("id");
    setBusy(false);
    if (error) {
      if (error.code === "23505") setErrs({ phone: "Bu numara başka bir müşteride kayıtlı." });
      else toast("Kaydedilemedi. " + error.message, "error");
      return;
    }
    if (!data || data.length === 0) {
      toast("Kaydedilemedi. Bu müşteriyi düzenleme yetkiniz yok.", "error");
      return;
    }
    toast("Bilgiler güncellendi");
    onSaved();
  };

  return (
    <form className="mu-form" onSubmit={save} noValidate>
      <Input label="Ad soyad" value={name} onChange={(e) => setName(e.target.value)} error={errs.name} required />
      <Input
        label="Telefon"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        error={errs.phone}
        inputMode="tel"
        required
      />
      <Select label="Operatör" value={operator} onChange={(e) => setOperator(e.target.value)}>
        <option value="">Belirtilmemiş</option>
        {Object.entries(OPERATOR_LABEL).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </Select>
      <Input
        label="Doğum tarihi"
        type="date"
        value={birth}
        max={dayKey(new Date())}
        onChange={(e) => setBirth(e.target.value)}
      />
      <div className="mu-inline" style={{ justifyContent: "flex-end" }}>
        <Button variant="soft" size="sm" onClick={onCancel} disabled={busy}>
          Vazgeç
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Kaydediliyor" : "Kaydet"}
        </Button>
      </div>
    </form>
  );
}

/* ---------- huni aşaması (set_pipeline_stage) ---------- */
function StageForm({ customer: c, onDone }: { customer: Customer; onDone: () => void }) {
  const toast = useToast();
  const [stage, setStage] = useState(c.pipeline_stage ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!stage) return;
    setBusy(true);
    const { error } = await createClient().rpc("set_pipeline_stage", {
      p_customer: c.id,
      p_stage: stage,
      p_note: note.trim() || undefined,
    });
    setBusy(false);
    if (error) {
      toast(error.message, "error");
      return;
    }
    setNote("");
    toast(`Aşama: ${STAGE_LABEL[stage]}`);
    onDone();
  };

  return (
    <div className="mu-form">
      <Select label="Aşama" value={stage} onChange={(e) => setStage(e.target.value)}>
        <option value="" disabled>
          Aşama seçin
        </option>
        {ALL_STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABEL[s]}
          </option>
        ))}
      </Select>
      <Textarea label="Not (isteğe bağlı)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      <div>
        <Button size="sm" onClick={save} disabled={busy || !stage || (stage === c.pipeline_stage && !note.trim())}>
          {busy ? "Kaydediliyor" : "Aşamayı kaydet"}
        </Button>
      </div>
    </div>
  );
}

/* ---------- devret (reassign_customer) ---------- */
function ReassignForm({ customer: c, members, onDone }: { customer: Customer; members: MemberLite[]; onDone: () => void }) {
  const toast = useToast();
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (!to) return;
    setBusy(true);
    const { error } = await createClient().rpc("reassign_customer", { p_customer: c.id, p_member: to });
    setBusy(false);
    if (error) {
      toast(error.message, "error");
      return;
    }
    toast(`Devredildi: ${memberName(members, to)}`);
    setTo("");
    onDone();
  };

  return (
    <div className="mu-inline">
      <Select label="Çalışan" value={to} onChange={(e) => setTo(e.target.value)}>
        <option value="">Çalışan seçin</option>
        {members
          .filter((m) => m.id !== c.assigned_to)
          .map((m) => (
            <option key={m.id} value={m.id}>
              {m.full_name}
            </option>
          ))}
      </Select>
      <Button size="sm" onClick={go} disabled={busy || !to}>
        {busy ? "Devrediliyor" : "Devret"}
      </Button>
    </div>
  );
}

/* ---------- zaman çizelgesi ---------- */
type TimelineItem = {
  key: string;
  kind: "call" | "stage";
  at: string;
  memberId: string;
  title: string;
  note: string | null;
  extra?: string;
};

function Timeline({ customerId, members }: { customerId: string; members: MemberLite[] }) {
  const [items, setItems] = useState<TimelineItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const supabase = createClient();
      const [calls, stages] = await Promise.all([
        supabase
          .from("call_attempts")
          .select("id, member_id, outcome, note, callback_at, created_at")
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("pipeline_events")
          .select("id, member_id, stage, note, created_at")
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      if (!alive) return;
      if (calls.error || stages.error) {
        setFailed(true);
        return;
      }
      const list: TimelineItem[] = [
        ...(calls.data ?? []).map((a) => ({
          key: `c${a.id}`,
          kind: "call" as const,
          at: a.created_at ?? "",
          memberId: a.member_id,
          title: `Arama: ${OUTCOME_LABEL[a.outcome] ?? a.outcome}`,
          note: a.note,
          extra: a.callback_at ? `Geri arama: ${formatDateTime(a.callback_at)}` : undefined,
        })),
        ...(stages.data ?? []).map((s) => ({
          key: `s${s.id}`,
          kind: "stage" as const,
          at: s.created_at ?? "",
          memberId: s.member_id,
          title: `Aşama: ${STAGE_LABEL[s.stage] ?? s.stage}`,
          note: s.note,
        })),
      ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
      setItems(list);
    })();
    return () => {
      alive = false;
    };
  }, [customerId]);

  if (failed) return <p className="mu-warn">Geçmiş yüklenemedi. Paneli kapatıp tekrar açın.</p>;
  if (items === null) return <p className="mu-warn">Yükleniyor</p>;
  if (items.length === 0) return <p className="mu-warn">Bu müşteri için henüz arama veya aşama kaydı yok.</p>;

  return (
    <ol className="mu-tl">
      {items.map((it) => (
        <li key={it.key} data-k={it.kind}>
          <b>{it.title}</b>
          <small>
            {memberName(members, it.memberId) || "Bilinmiyor"}, {it.at ? formatDateTime(it.at) : ""}
          </small>
          {it.extra ? <small>{it.extra}</small> : null}
          {it.note ? <p>{it.note}</p> : null}
        </li>
      ))}
    </ol>
  );
}

/* ---------- silme (KVKK) ---------- */
function DeleteModal({
  open,
  customer: c,
  onClose,
  onDeleted,
}: {
  open: boolean;
  customer: Customer;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");

  const go = async () => {
    setBusy(true);
    const { error } = await createClient().rpc("delete_customer", {
      p_customer: c.id,
      p_reason: reason.trim() || undefined,
    });
    setBusy(false);
    if (error) {
      toast("Silinemedi. " + error.message, "error");
      return;
    }
    onDeleted();
  };

  return (
    <Modal open={open} onClose={onClose} title="Müşteri silinsin mi?">
      <p className="mu-warn">
        <b>{c.full_name}</b> ve bu müşteriye ait tüm arama ve aşama geçmişi kalıcı olarak silinir. Bu işlem geri alınamaz.
        Yalnız müşterinin KVKK kapsamındaki silme talebi için kullanın ve talebi kayıt altına alın.
      </p>
      <Input
        label="Silme nedeni (isteğe bağlı)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={200}
        placeholder="Örn. KVKK silme talebi"
      />
      <div className="modal-foot">
        <Button variant="soft" onClick={onClose} disabled={busy}>
          Vazgeç
        </Button>
        <Button className="btn-danger-solid" onClick={go} disabled={busy}>
          {busy ? "Siliniyor" : "Kalıcı olarak sil"}
        </Button>
      </div>
    </Modal>
  );
}
