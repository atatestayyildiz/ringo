"use client";

import { useEffect, useState, useTransition } from "react";
import {
  loadNotificationsAction,
  saveNotificationSettingsAction,
  savePushSettingsAction,
  type NotificationsData,
} from "@/app/(app)/ayarlar/notification-actions";
import a from "@/components/ayarlar/ayarlar.module.css";
import { formatHm, maskHm, parseHm } from "@/components/ayarlar/shared";
import s from "@/components/profil/profil.module.css";
import { PushCard } from "@/components/push/PushCard";
import { Avatar, Button, Card, Chip, EmptyState, Input, Select, Switch, useToast } from "@/components/ui";
import type { PushStatus } from "@/lib/push/status";
import type { TenantSettings } from "@/lib/session";

const timeError = (raw: string) => (parseHm(raw) ? undefined : "Saati SS:DD biçiminde girin, örneğin 08:30.");

const KINDS: { name: string; text: string; live: boolean }[] = [
  { name: "Geri arama vakti", text: "Sonra ara dediğiniz müşterinin saati gelince, atanmış çalışana.", live: true },
  { name: "Randevu hatırlatma", text: "Dükkana gelecek randevudan belirlenen süre önce, atanmış çalışana.", live: true },
  { name: "Sabah özeti", text: "Günün arama listesi özeti.", live: false },
  { name: "Akşam özeti", text: "Gün sonu özeti.", live: false },
  { name: "Yeni devir ve atama", text: "Size müşteri atandığında.", live: false },
  { name: "PIN kilitlendi", text: "Hesabınız PIN hatalarıyla kilitlendiğinde.", live: false },
];

export function NotificationsPanel({ settings, selfPush }: { settings: TenantSettings; selfPush: PushStatus | null }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(settings.push_enabled);
  const [lead, setLead] = useState(String(settings.appointment_lead_minutes));
  const [morning, setMorning] = useState(formatHm(settings.distribution_hour, settings.distribution_minute));
  const [data, setData] = useState<NotificationsData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void loadNotificationsAction().then((res) => {
      if (!live) return;
      if (res.ok) setData(res.data);
      else setLoadError(res.error);
    });
    return () => {
      live = false;
    };
  }, []);

  const morningErr = timeError(morning);

  const savePush = () =>
    start(async () => {
      const res = await savePushSettingsAction({ enabled, lead: Number(lead) });
      if (res.ok) toast("Bildirim ayarları kaydedildi.");
      else toast(res.error, "error");
    });

  const saveHours = () => {
    const m = parseHm(morning);
    if (!m) return toast("Kırmızı işaretli alanları düzeltin.", "error");
    start(async () => {
      const res = await saveNotificationSettingsAction({ distribution_hour: m.hour, distribution_minute: m.minute });
      if (res.ok) toast("Dağıtım saati kaydedildi.");
      else toast(res.error, "error");
    });
  };

  const onCount = data?.team.filter((m) => m.devices > 0).length ?? 0;
  const missing = data
    ? [
        !data.vapidConfigured && "NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT",
        !data.cronSecretConfigured && "CRON_SECRET",
        !data.appUrlConfigured && "APP_URL",
      ].filter(Boolean)
    : [];

  return (
    <div className={a.cols}>
      <div className={a.stack}>
        <Card>
          <h2>Hangi bildirimler gönderilir</h2>
          <p className={s.sub}>Bildirimler çalışanların telefonuna gelir. Telefon numarası bildirimde görünmez.</p>
          <div className={s.kinds}>
            {KINDS.map((k) => (
              <div key={k.name} className={s.kind}>
                <div>
                  <b>{k.name}</b>
                  <small>{k.text}</small>
                </div>
                <Chip>{k.live ? "Açık" : "Yakında"}</Chip>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2>Mağaza ayarı</h2>
          <div className={s.formGrid}>
            <div className={s.full}>
              <Switch label="Bildirimler açık" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            </div>
            <Select
              label="Randevu hatırlatma süresi"
              hint="Randevudan ne kadar önce haber verilsin."
              value={lead}
              onChange={(e) => setLead(e.target.value)}
            >
              <option value="30">30 dakika önce</option>
              <option value="60">60 dakika önce</option>
              <option value="120">120 dakika önce</option>
            </Select>
          </div>
          <div className={s.row}>
            <Button variant="brand" onClick={savePush} disabled={pending}>
              {pending ? "Kaydediliyor" : "Kaydet"}
            </Button>
          </div>
          {missing.length > 0 ? (
            <div className={s.warn}>Sunucuda eksik ortam değişkenleri: {missing.join(", ")}. Kurulum rehberine bakın.</div>
          ) : null}
        </Card>

        <PushCard initial={selfPush} title="Bu cihazdaki bildirimlerim" />
      </div>

      <div className={a.stack}>
        <Card>
          <h2>Dağıtım saati</h2>
          <p className={s.sub}>Saat yerel saattir, 24 saat biçiminde (örneğin 08:30).</p>
          <div className={s.formGrid}>
            <Input
              label="Sabah listesi"
              hint="Müşteriler bu saatte çalışanlara dağıtılır."
              error={morningErr}
              type="text"
              inputMode="numeric"
              placeholder="08:30"
              maxLength={5}
              autoComplete="off"
              value={morning}
              onChange={(e) => setMorning(maskHm(e.target.value))}
              onBlur={() => {
                const p = parseHm(morning);
                if (p) setMorning(formatHm(p.hour, p.minute));
              }}
            />
          </div>
          <div className={s.row}>
            <Button variant="brand" onClick={saveHours} disabled={pending}>
              {pending ? "Kaydediliyor" : "Saati kaydet"}
            </Button>
          </div>
        </Card>

        <Card>
          <h2>Ekip bildirimleri</h2>
          <p className={s.sub}>Kimin kaç cihazında bildirim açık olduğunu ve seçtiği türleri gösterir.</p>
          {loadError ? <div className={s.warn}>{loadError}</div> : null}
          {!data && !loadError ? <p className={s.sub}>Yükleniyor</p> : null}
          {data && data.team.length === 0 ? <EmptyState title="Ekip boş">Önce Ekip sekmesinden çalışan ekleyin.</EmptyState> : null}
          {data && data.team.length > 0 ? (
            <>
              <p className={s.sub}>
                {data.team.length} kişiden {onCount} tanesi en az bir cihazda açtı.
              </p>
              <div className={s.team}>
                {data.team.map((m) => (
                  <div key={m.id} className={s.teamRow}>
                    <Avatar name={m.full_name} size={36} />
                    <div>
                      <b>{m.full_name}</b>
                      <small className={s.count} style={{ display: "block" }}>
                        {[m.notify_callback && "Geri arama", m.notify_appointment && "Randevu"].filter(Boolean).join(", ") ||
                          "Tür seçmemiş"}
                      </small>
                    </div>
                    <Chip>{m.devices > 0 ? `${m.devices} cihaz` : "Kapalı"}</Chip>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
