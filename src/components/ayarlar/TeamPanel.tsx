"use client";

import { useState, useTransition } from "react";
import {
  createMemberAction,
  deleteMemberAction,
  resetMemberPinAction,
  setMemberActiveAction,
  setMemberRoleAction,
  setPermissionAction,
} from "@/app/(app)/ayarlar/actions";
import { Avatar, Button, Chip, EmptyState, Input, Modal, Select, Switch, useToast } from "@/components/ui";
import { PERMISSIONS, generatePassword, permGroup, type MemberRow, type PermKey } from "./shared";
import s from "./ayarlar.module.css";

export function TeamPanel({ members, emailWarning }: { members: MemberRow[]; emailWarning: string | null }) {
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <div className={s.head}>
        <p>{members.length} kişi. Çalışanın görebileceklerini yetki anahtarlarıyla yönetin.</p>
        <Button variant="brand" onClick={() => setAdding(true)}>
          Çalışan ekle
        </Button>
      </div>
      {emailWarning ? <div className={s.notice}>{emailWarning}</div> : null}

      {members.length === 0 ? (
        <EmptyState title="Henüz ekip yok">Çalışan ekle düğmesiyle ilk kişiyi tanımlayın.</EmptyState>
      ) : (
        <div className={s.list}>
          {members.map((m) => (
            <MemberCard key={m.id} m={m} expanded={open === m.id} onToggle={() => setOpen(open === m.id ? null : m.id)} />
          ))}
        </div>
      )}

      <AddMemberModal open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function MemberCard({ m, expanded, onToggle }: { m: MemberRow; expanded: boolean; onToggle: () => void }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [perms, setPerms] = useState(m.permissions);
  const isManager = m.role === "manager";

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) toast(res.error ?? "İşlem yapılamadı.", "error");
      else if (okMsg) toast(okMsg);
    });

  const togglePerm = (key: PermKey, value: boolean) => {
    const prev = perms;
    setPerms({ ...perms, ...Object.fromEntries(permGroup(key).map((k) => [k, value])) });
    start(async () => {
      const res = await setPermissionAction(m.id, key, value);
      if (!res.ok) {
        setPerms(prev);
        toast(res.error, "error");
      }
    });
  };

  return (
    <div className={`${s.member} ${m.is_active ? "" : s.inactive}`} data-member={m.email}>
      <div className={s.memberTop}>
        <Avatar name={m.full_name} />
        <div className={s.who}>
          <b>
            {m.full_name}
            {m.isSelf ? <Chip>Siz</Chip> : null}
            {!m.is_active ? <Chip className={s.off}>Pasif</Chip> : null}
          </b>
          <small>{m.email || "E-posta okunamadı"}</small>
        </div>
        <div className={s.controls}>
          <Select
            label=""
            aria-label={`${m.full_name} rolü`}
            className={s.roleSelect}
            value={m.role}
            disabled={pending || m.isSelf}
            onChange={(e) =>
              run(() => setMemberRoleAction(m.id, e.target.value as "manager" | "agent"), "Rol güncellendi.")
            }
          >
            <option value="agent">Çalışan</option>
            <option value="manager">Yönetici</option>
          </Select>
          <Button
            variant="soft"
            size="sm"
            disabled={pending || (m.isSelf && m.is_active)}
            onClick={() =>
              run(
                () => setMemberActiveAction(m.id, !m.is_active),
                m.is_active ? `${m.full_name} pasifleştirildi.` : `${m.full_name} aktifleştirildi.`,
              )
            }
          >
            {m.is_active ? "Pasifleştir" : "Aktifleştir"}
          </Button>
          {!m.isSelf && !m.is_active ? (
            <Button
              variant="soft"
              size="sm"
              disabled={pending}
              onClick={() => {
                if (
                  window.confirm(
                    `${m.full_name} kalıcı olarak silinsin mi? Giriş hesabı ve e-posta adresi kaldırılır, geçmiş kayıtlarda "Silinmiş kullanıcı" görünür. Bu işlem geri alınamaz.`,
                  )
                ) {
                  run(() => deleteMemberAction(m.id), `${m.full_name} silindi.`);
                }
              }}
            >
              Sil
            </Button>
          ) : null}
          {!m.isSelf ? (
            <Button
              variant="soft"
              size="sm"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`${m.full_name} için PIN sıfırlansın mı? Bir sonraki girişte yeni PIN belirler.`)) {
                  run(() => resetMemberPinAction(m.id), `${m.full_name} için PIN sıfırlandı.`);
                }
              }}
            >
              PIN sıfırla
            </Button>
          ) : null}
          <Button variant="ink" size="sm" aria-expanded={expanded} onClick={onToggle}>
            Yetkiler
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className={s.perms}>
          {isManager ? (
            <p className={s.permAll}>Yönetici her şeyi yapabilir. Ayrı yetki gerekmez.</p>
          ) : (
            PERMISSIONS.map((p) => (
              <div className={s.perm} key={p.key}>
                <div className={s.permText}>
                  <b style={{ fontSize: 14, fontWeight: 600 }}>{p.label}</b>
                  <small>{p.desc}</small>
                </div>
                <Switch
                  label=""
                  aria-label={`${m.full_name}: ${p.label}`}
                  checked={(p.group ?? [p.key]).some((k) => perms[k] === true)}
                  disabled={pending}
                  onChange={(e) => togglePerm(p.key, e.target.checked)}
                />
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function AddMemberModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"agent" | "manager">("agent");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  const reset = () => {
    setName("");
    setEmail("");
    setPassword("");
    setRole("agent");
    setError(null);
    setCreated(null);
  };
  const close = () => {
    if (pending) return;
    reset();
    onClose();
  };

  const copy = async (text: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(msg);
    } catch {
      toast("Kopyalanamadı. Metni elle seçip kopyalayın.", "error");
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createMemberAction({ full_name: name, email, password, role });
      if (res.ok) setCreated({ email: email.trim().toLowerCase(), password });
      else setError(res.error);
    });
  };

  return (
    <Modal open={open} onClose={close} title={created ? "Çalışan eklendi" : "Çalışan ekle"}>
      {created ? (
        <div className={s.created}>
          <div className={s.cred}>
            E-posta: <code>{created.email}</code>
            <br />
            Geçici şifre: <code>{created.password}</code>
          </div>
          <p className={s.warn}>Şifre bir daha gösterilmez. Çalışana şimdi iletin; ilk girişte değiştirmesini söyleyin.</p>
          <div className="modal-foot">
            <Button
              variant="soft"
              onClick={() => copy(`E-posta: ${created.email}\nŞifre: ${created.password}`, "Giriş bilgileri kopyalandı.")}
            >
              Bilgileri kopyala
            </Button>
            <Button variant="ink" onClick={close} data-autofocus>
              Tamam
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className={s.formStack}>
          <Input label="Ad soyad" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoComplete="off" data-autofocus />
          <Input
            label="E-posta"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="off"
          />
          <div className="field">
            <label className={s.pwLabel} htmlFor="new-member-password">
              Geçici şifre
            </label>
            <div className={s.pwRow}>
              <input
                id="new-member-password"
                className="input"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="off"
                aria-describedby="new-member-password-hint"
              />
              <Button variant="soft" size="sm" className={s.pwBtn} onClick={() => setPassword(generatePassword())}>
                Öner
              </Button>
              <Button
                variant="soft"
                size="sm"
                className={s.pwBtn}
                disabled={!password}
                onClick={() => copy(password, "Şifre kopyalandı.")}
              >
                Kopyala
              </Button>
            </div>
            <span className="hint" id="new-member-password-hint">
              En az 8 karakter.
            </span>
          </div>
          <Select label="Rol" value={role} onChange={(e) => setRole(e.target.value as "agent" | "manager")}>
            <option value="agent">Çalışan</option>
            <option value="manager">Yönetici</option>
          </Select>
          {error ? (
            <div className="form-error" role="alert">
              {error}
            </div>
          ) : null}
          <div className="modal-foot">
            <Button variant="soft" onClick={close} disabled={pending}>
              Vazgeç
            </Button>
            <Button variant="brand" type="submit" disabled={pending}>
              {pending ? "Ekleniyor" : "Ekle"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
