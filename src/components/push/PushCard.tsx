"use client";

import { useCallback, useEffect, useState } from "react";
import s from "@/components/profil/profil.module.css";
import { Button, Card, Switch, useToast } from "@/components/ui";
import { toUserMessage } from "@/lib/errors";
import {
  detectPushState,
  disablePush,
  enablePush,
  fetchPushStatus,
  PushClientError,
  resyncPush,
  savePushPrefs,
  type PushState,
} from "@/lib/push/client";
import type { PushStatus } from "@/lib/push/status";

export function PushCard({ initial, title = "Bildirimler" }: { initial: PushStatus | null; title?: string }) {
  const toast = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [status, setStatus] = useState<PushStatus | null>(initial);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const refreshStatus = useCallback(async () => {
    const st = await fetchPushStatus();
    if (st) setStatus(st);
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      const st = await detectPushState();
      if (!live) return;
      setState(st);
      if (st === "on") {
        await resyncPush();
        if (live) await refreshStatus();
      }
    })();
    return () => {
      live = false;
    };
  }, [refreshStatus]);

  const turnOn = async () => {
    setBusy(true);
    try {
      const next = await enablePush();
      setState(next);
      if (next === "on") {
        toast("Bildirimler bu cihazda açıldı.");
        await refreshStatus();
      } else if (next === "denied") {
        toast("Bildirim izni verilmedi.", "error");
      }
    } catch (e) {
      toast(e instanceof PushClientError ? e.message : toUserMessage(null), "error");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      await disablePush();
      setState("off");
      toast("Bildirimler bu cihazda kapatıldı.");
      await refreshStatus();
    } catch (e) {
      toast(e instanceof PushClientError ? e.message : toUserMessage(null), "error");
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (body.ok) toast("Test bildirimi gönderildi.");
      else toast(body.error ?? "Test bildirimi gönderilemedi.", "error");
    } catch {
      toast("Bağlantı kurulamadı. İnternetinizi kontrol edip tekrar deneyin.", "error");
    } finally {
      setTesting(false);
    }
  };

  const setPref = async (key: "notify_callback" | "notify_appointment", value: boolean) => {
    if (!status) return;
    const prev = status;
    const next = { ...status, [key]: value };
    setStatus(next);
    try {
      await savePushPrefs(next.notify_callback, next.notify_appointment);
    } catch (e) {
      setStatus(prev);
      toast(e instanceof PushClientError ? e.message : toUserMessage(null), "error");
    }
  };

  const devices = status?.devices ?? 0;

  return (
    <Card>
      <h2>{title}</h2>
      <p className={s.sub}>Geri arama vakti ve randevu hatırlatmaları telefonuna bildirim olarak gelir.</p>

      {status && !status.push_enabled ? (
        <div className={s.warn}>Bildirimler yönetici tarafından kapatıldı. Açılınca bu cihazda tekrar çalışır.</div>
      ) : null}

      {state === null ? <p className={s.count}>Kontrol ediliyor</p> : null}

      {state === "unsupported" ? (
        <div className={s.warn}>Bu tarayıcı bildirimleri desteklemiyor. Chrome veya Safari&apos;nin güncel sürümünü deneyin.</div>
      ) : null}

      {state === "ios-install" ? (
        <div className={s.codeBox}>
          <b>iPhone&apos;da önce uygulamayı ana ekrana ekle</b>
          <ol className={s.steps}>
            <li>Safari&apos;de bu sayfayı aç.</li>
            <li>
              Alttaki <b>Paylaş</b> düğmesine dokun.
            </li>
            <li>
              <b>Ana Ekrana Ekle</b>&apos;yi seç ve onayla.
            </li>
            <li>Ana ekrandaki simgeden uygulamayı aç, bu karta dön ve bildirimleri aç.</li>
          </ol>
        </div>
      ) : null}

      {state === "denied" ? (
        <div className={s.warn}>
          Bildirim izni kapalı. Tarayıcı veya telefon ayarlarından bu uygulamanın bildirimlerine izin verip sayfayı yenile.
        </div>
      ) : null}

      {state === "off" || state === "on" ? (
        <>
          <div className={s.row} style={{ marginTop: 0 }}>
            <span className={s.state} data-on={state === "on"}>
              {state === "on" ? "Bu cihazda açık" : "Bu cihazda kapalı"}
            </span>
            <span className={s.count}>{devices === 0 ? "Bildirimi açık cihaz yok" : `${devices} cihazda açık`}</span>
          </div>
          <div className={s.row}>
            {state === "on" ? (
              <>
                <Button size="sm" variant="soft" onClick={sendTest} disabled={testing}>
                  {testing ? "Gönderiliyor" : "Test bildirimi gönder"}
                </Button>
                <Button size="sm" variant="soft" onClick={turnOff} disabled={busy}>
                  Bu cihazda kapat
                </Button>
              </>
            ) : (
              <Button size="sm" variant="brand" onClick={turnOn} disabled={busy}>
                {busy ? "Açılıyor" : "Bu cihazda bildirimleri aç"}
              </Button>
            )}
          </div>
        </>
      ) : null}

      <div className={s.prefs} style={{ marginTop: 16 }}>
        <div className={s.pref}>
          <Switch
            label="Geri arama vakti"
            checked={status?.notify_callback ?? true}
            disabled={!status}
            onChange={(e) => void setPref("notify_callback", e.target.checked)}
          />
        </div>
        <div className={s.pref}>
          <Switch
            label="Randevu hatırlatma"
            checked={status?.notify_appointment ?? true}
            disabled={!status}
            onChange={(e) => void setPref("notify_appointment", e.target.checked)}
          />
        </div>
      </div>
    </Card>
  );
}
