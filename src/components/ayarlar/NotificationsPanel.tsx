"use client";

import { useEffect, useState, useTransition } from "react";
import {
  loadNotificationsAction,
  saveNotificationSettingsAction,
  unlinkMemberTelegramAction,
  type NotificationsData,
} from "@/app/(app)/ayarlar/notification-actions";
import a from "@/components/ayarlar/ayarlar.module.css";
import { TelegramCard } from "@/components/profil/TelegramCard";
import s from "@/components/profil/profil.module.css";
import { formatHm, maskHm, parseHm } from "@/components/ayarlar/shared";
import { Avatar, Button, Card, Chip, EmptyState, Input, Switch, useToast } from "@/components/ui";
import type { TenantSettings } from "@/lib/session";

const timeError = (raw: string) => (parseHm(raw) ? undefined : "Saati SS:DD biçiminde girin, örneğin 08:30.");

export type SelfTelegram = {
  linked: boolean;
  linkedAt: string | null;
  botConfigured: boolean;
  prefs: { morning: boolean; summary: boolean };
};

export function NotificationsPanel({ settings, selfTelegram }: { settings: TenantSettings; selfTelegram: SelfTelegram }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(settings.telegram_enabled);
  const [bot, setBot] = useState(settings.telegram_bot_username ?? "");
  const [morning, setMorning] = useState(formatHm(settings.distribution_hour, settings.distribution_minute));
  const [evening, setEvening] = useState(formatHm(settings.summary_hour, settings.summary_minute));
  const [data, setData] = useState<NotificationsData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = async () => {
    const res = await loadNotificationsAction();
    if (res.ok) {
      setData(res.data);
      setLoadError(null);
    } else {
      setLoadError(res.error);
    }
  };

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
  const eveningErr = timeError(evening);
  const botClean = bot.trim().replace(/^@/, "");
  const botErr = botClean !== "" && !/^[A-Za-z0-9_]{3,64}$/.test(botClean) ? "Harf, rakam ve alt çizgi, en az 3 karakter." : undefined;

  const save = () => {
    if (botErr) return toast("Kırmızı işaretli alanları düzeltin.", "error");
    start(async () => {
      const res = await saveNotificationSettingsAction({
        telegram_enabled: enabled,
        telegram_bot_username: botClean,
      });
      if (res.ok) toast("Bildirim ayarları kaydedildi.");
      else toast(res.error, "error");
    });
  };

  const saveHours = () => {
    const m = parseHm(morning);
    const e = parseHm(evening);
    if (!m || !e) return toast("Kırmızı işaretli alanları düzeltin.", "error");
    start(async () => {
      const res = await saveNotificationSettingsAction({
        distribution_hour: m.hour,
        distribution_minute: m.minute,
        summary_hour: e.hour,
        summary_minute: e.minute,
      });
      if (res.ok) toast("Gönderim saatleri kaydedildi.");
      else toast(res.error, "error");
    });
  };

  const unlink = (id: string, name: string) =>
    start(async () => {
      const res = await unlinkMemberTelegramAction(id);
      if (!res.ok) return toast(res.error, "error");
      toast(`${name} için Telegram bağlantısı kaldırıldı.`);
      await reload();
    });

  const webhookUrl = `${data?.appUrl || "<APP_URL>"}/api/telegram/webhook`;
  const linkedCount = data?.team.filter((m) => m.linked).length ?? 0;

  return (
    <div className={a.cols}>
      <div className={a.stack}>
        <TelegramCard
          title="Telegram hesabım"
          linked={selfTelegram.linked}
          linkedAt={selfTelegram.linkedAt}
          botUsername={settings.telegram_bot_username}
          tenantEnabled={settings.telegram_enabled}
          botConfigured={selfTelegram.botConfigured}
          prefs={selfTelegram.prefs}
          showSummary
        />
        <Card>
          <h2>Telegram bildirimleri</h2>
          <p className={s.sub}>Çalışanlar bağlantıyı kendi Profil sayfasından kurar.</p>
          <div className={s.formGrid}>
            <div className={s.full}>
              <Switch
                label="Telegram bildirimleri açık"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
            </div>
            <Input
              label="Bot kullanıcı adı"
              hint="@ olmadan, örneğin firma_bot."
              error={botErr}
              value={bot}
              onChange={(e) => setBot(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className={s.row}>
            <Button variant="brand" onClick={save} disabled={pending}>
              {pending ? "Kaydediliyor" : "Kaydet"}
            </Button>
          </div>
        </Card>

        {data && !data.botConfigured ? (
          <Card>
            <h2>Kurulum</h2>
            <div className={s.warn}>Bot anahtarı sunucuya eklenmedi. Kurulum adımları:</div>
            <ol className={s.steps}>
              <li>
                Telegram&apos;da <code>@BotFather</code> ile sohbet açıp <code>/newbot</code> yaz.
              </li>
              <li>Botun adını ve kullanıcı adını ver (kullanıcı adı <code>bot</code> ile biter).</li>
              <li>
                BotFather&apos;ın verdiği anahtarı sunucu ortam değişkeni <code>TELEGRAM_BOT_TOKEN</code> olarak ekle.
              </li>
              <li>
                Webhook&apos;u ayarla: Bot API&apos;de <code>setWebhook</code> çağrısında <code>url={webhookUrl}</code> ve{" "}
                <code>secret_token=&lt;TELEGRAM_WEBHOOK_SECRET&gt;</code> ver.
              </li>
            </ol>
            {!data.webhookSecretConfigured || !data.cronSecretConfigured || !data.appUrl ? (
              <p className={s.sub} style={{ marginBottom: 0 }}>
                Ayrıca eksik ortam değişkenleri:{" "}
                {[
                  !data.webhookSecretConfigured && "TELEGRAM_WEBHOOK_SECRET",
                  !data.cronSecretConfigured && "CRON_SECRET",
                  !data.appUrl && "APP_URL",
                ]
                  .filter(Boolean)
                  .join(", ")}
                .
              </p>
            ) : null}
          </Card>
        ) : null}
      </div>

      <div className={a.stack}>
        <Card>
          <h2>Gönderim saatleri</h2>
          <p className={s.sub}>Saatler yerel saattir, 24 saat biçiminde (örneğin 08:30).</p>
          <div className={s.formGrid}>
            <Input
              label="Sabah listesi"
              hint="Müşteriler bu saatte dağıtılır ve sabah mesajı gider."
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
            <Input
              label="Akşam özeti"
              hint="Gün sonu özeti bu saatte gider."
              error={eveningErr}
              type="text"
              inputMode="numeric"
              placeholder="19:00"
              maxLength={5}
              autoComplete="off"
              value={evening}
              onChange={(e) => setEvening(maskHm(e.target.value))}
              onBlur={() => {
                const p = parseHm(evening);
                if (p) setEvening(formatHm(p.hour, p.minute));
              }}
            />
          </div>
          <div className={s.row}>
            <Button variant="brand" onClick={saveHours} disabled={pending}>
              {pending ? "Kaydediliyor" : "Saatleri kaydet"}
            </Button>
          </div>
        </Card>

        <Card>
          <h2>Telegram bağlantıları</h2>
          <p className={s.sub}>
            Bu liste çevrimiçi durumu göstermez. Telegram hesabını bağlayıp bildirim alabilen çalışanları gösterir.
          </p>
          {loadError ? <div className={s.warn}>{loadError}</div> : null}
          {!data && !loadError ? <p className={s.sub}>Yükleniyor</p> : null}
          {data && data.team.length === 0 ? <EmptyState title="Ekip boş">Önce Ekip sekmesinden çalışan ekleyin.</EmptyState> : null}
          {data && data.team.length > 0 ? (
            <>
              <p className={s.sub}>
                {data.team.length} kişiden {linkedCount} tanesi bağlı.
              </p>
              <div className={s.team}>
                {data.team.map((m) => (
                  <div key={m.id} className={s.teamRow}>
                    <Avatar name={m.full_name} size={36} />
                    <div>
                      <b>{m.full_name}</b>
                    </div>
                    <Chip>{m.linked ? "Bağlı" : "Bağlı değil"}</Chip>
                    {m.linked ? (
                      <Button size="sm" variant="soft" disabled={pending} onClick={() => unlink(m.id, m.full_name)}>
                        Kaldır
                      </Button>
                    ) : null}
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
