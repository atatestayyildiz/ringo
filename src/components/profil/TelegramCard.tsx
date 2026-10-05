"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  createLinkCodeAction,
  saveNotifyPrefsAction,
  telegramStatusAction,
  unlinkSelfAction,
} from "@/app/(app)/profil/actions";
import { Button, buttonClass, Card, Switch, useToast } from "@/components/ui";
import s from "./profil.module.css";

type Prefs = { morning: boolean; summary: boolean };

function fmtLeft(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

export function TelegramCard({
  linked: linkedInit,
  linkedAt,
  botUsername,
  tenantEnabled,
  botConfigured,
  prefs: prefsInit,
  showSummary,
  title = "Telegram",
}: {
  linked: boolean;
  linkedAt: string | null;
  botUsername: string | null;
  tenantEnabled: boolean;
  botConfigured: boolean;
  prefs: Prefs;
  showSummary: boolean;
  title?: string;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [linked, setLinked] = useState(linkedInit);
  const [since, setSince] = useState(linkedAt);
  const [code, setCode] = useState<string | null>(null);
  const [expires, setExpires] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [prefs, setPrefs] = useState(prefsInit);
  const [testing, setTesting] = useState(false);

  const left = code ? expires - now : 0;
  const active = code !== null && left > 0;

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  const refresh = useCallback(async (quiet: boolean) => {
    const res = await telegramStatusAction();
    if (!res.ok) {
      if (!quiet) toast(res.error, "error");
      return;
    }
    setLinked(res.linked);
    setSince(res.linkedAt);
    if (res.linked) {
      setCode(null);
      if (!quiet) toast("Telegram bağlı.");
    } else if (!quiet) {
      toast("Henüz bağlanmadı.");
    }
  }, [toast]);

  // Kod aktifken bağlanmayı kendiliğinden yakala
  useEffect(() => {
    if (!active || linked) return;
    const id = setInterval(() => void refresh(true), 4000);
    return () => clearInterval(id);
  }, [active, linked, refresh]);

  const makeCode = () =>
    start(async () => {
      const res = await createLinkCodeAction();
      if (!res.ok) return toast(res.error, "error");
      setCode(res.code);
      setExpires(new Date(res.expiresAt).getTime());
      setNow(Date.now());
    });

  const unlink = () =>
    start(async () => {
      const res = await unlinkSelfAction();
      if (!res.ok) return toast(res.error, "error");
      setLinked(false);
      setSince(null);
      toast("Telegram bağlantısı kaldırıldı.");
    });

  const savePref = (key: keyof Prefs, value: boolean) => {
    const next = { ...prefs, [key]: value };
    const prev = prefs;
    setPrefs(next);
    start(async () => {
      const res = await saveNotifyPrefsAction(next);
      if (!res.ok) {
        setPrefs(prev);
        toast(res.error, "error");
      }
    });
  };

  const sendTest = async () => {
    if (!botConfigured) return toast("Bot henüz kurulmadı.", "error");
    if (!linked) return toast("Önce Telegram hesabını bağla.", "error");
    setTesting(true);
    try {
      const res = await fetch("/api/telegram/test", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (body.ok) toast("Test mesajı gönderildi.");
      else toast(body.error ?? "Test mesajı gönderilemedi.", "error");
    } catch {
      toast("Bağlantı kurulamadı. İnternetinizi kontrol edip tekrar deneyin.", "error");
    } finally {
      setTesting(false);
    }
  };

  const tme = code && botUsername ? `https://t.me/${botUsername}?start=${code}` : null;

  return (
    <Card>
      <h2>{title}</h2>
      <p className={s.sub}>
        Günlük arama listesi ve özet Telegram sohbetine gelir.
      </p>

      {!tenantEnabled ? (
        <div className={s.warn}>Telegram bildirimleri yönetici tarafından henüz açılmadı. Bağlayabilirsin, mesajlar açılınca başlar.</div>
      ) : null}

      <div className={s.row} style={{ marginTop: tenantEnabled ? 0 : 16 }}>
        <span className={s.state} data-on={linked}>
          {linked ? "Bağlı" : "Bağlı değil"}
        </span>
        {linked && since ? (
          <span className={s.count}>
            {new Date(since).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })} tarihinden beri
          </span>
        ) : null}
      </div>

      {linked ? (
        <div className={s.row}>
          <Button size="sm" variant="soft" onClick={sendTest} disabled={testing}>
            {testing ? "Gönderiliyor" : "Test mesajı gönder"}
          </Button>
          <Button size="sm" variant="soft" onClick={unlink} disabled={pending}>
            Bağlantıyı kaldır
          </Button>
        </div>
      ) : (
        <>
          <div className={s.row}>
            <Button size="sm" variant="brand" onClick={makeCode} disabled={pending}>
              {code ? "Yeni kod üret" : "Telegram'ı bağla"}
            </Button>
            <Button size="sm" variant="soft" onClick={sendTest} disabled={testing}>
              Test mesajı gönder
            </Button>
          </div>
          {code ? (
            <div className={s.codeBox} data-testid="link-code-box">
              <span className={s.count}>Bağlama kodun</span>
              <span className={s.code} data-testid="link-code">
                {code}
              </span>
              {active ? (
                <span className={s.count} aria-live="off">
                  Kalan süre: {fmtLeft(left)}
                </span>
              ) : (
                <span className={s.count}>Kodun süresi doldu. Yeni kod üret.</span>
              )}
              {active && tme ? (
                <div className={s.row} style={{ marginTop: 0 }}>
                  <a href={tme} className={buttonClass("ink", "sm")} target="_blank" rel="noopener noreferrer">
                    Telegram&apos;da aç
                  </a>
                  <Button size="sm" variant="soft" onClick={() => void refresh(false)}>
                    Durumu yenile
                  </Button>
                </div>
              ) : null}
              {active && !tme ? (
                <>
                  <span className={s.count}>
                    Bota <b>/start {code}</b> yaz. Bot kullanıcı adı henüz ayarlanmadığı için hazır bağlantı yok.
                  </span>
                  <div>
                    <Button size="sm" variant="soft" onClick={() => void refresh(false)}>
                      Durumu yenile
                    </Button>
                  </div>
                </>
              ) : null}
              {active && tme ? (
                <span className={s.count}>
                  Bağlantı açılmazsa bota <b>/start {code}</b> yaz.
                </span>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      <div className={s.prefs}>
        <div className={s.pref}>
          <Switch
            label="Sabah listesi"
            checked={prefs.morning}
            onChange={(e) => savePref("morning", e.target.checked)}
          />
        </div>
        {showSummary ? (
          <div className={s.pref}>
            <Switch
              label="Akşam özeti"
              checked={prefs.summary}
              onChange={(e) => savePref("summary", e.target.checked)}
            />
          </div>
        ) : null}
      </div>
    </Card>
  );
}
