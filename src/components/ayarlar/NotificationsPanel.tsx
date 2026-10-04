"use client";

import { useEffect, useState, useTransition } from "react";
import {
  loadNotificationsAction,
  saveNotificationSettingsAction,
  unlinkMemberTelegramAction,
  type NotificationsData,
} from "@/app/(app)/ayarlar/notification-actions";
import s from "@/components/profil/profil.module.css";
import { Avatar, Button, Card, Chip, EmptyState, Input, Switch, useToast } from "@/components/ui";
import type { TenantSettings } from "@/lib/session";

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

export function NotificationsPanel({ settings }: { settings: TenantSettings }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(settings.telegram_enabled);
  const [bot, setBot] = useState(settings.telegram_bot_username ?? "");
  const [hour, setHour] = useState(String(settings.reminder_hour));
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

  const hourNum = hour.trim() === "" ? NaN : Number(hour);
  const hourErr =
    Number.isInteger(hourNum) && hourNum >= 0 && hourNum <= 23 ? undefined : "0 ile 23 arasında bir tam sayı girin.";
  const botClean = bot.trim().replace(/^@/, "");
  const botErr = botClean !== "" && !/^[A-Za-z0-9_]{3,64}$/.test(botClean) ? "Harf, rakam ve alt çizgi, en az 3 karakter." : undefined;

  const save = () => {
    if (hourErr || botErr) return toast("Kırmızı işaretli alanları düzeltin.", "error");
    start(async () => {
      const res = await saveNotificationSettingsAction({
        telegram_enabled: enabled,
        telegram_bot_username: botClean,
        reminder_hour: hourNum,
      });
      if (res.ok) toast("Bildirim ayarları kaydedildi.");
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
    <div className={s.cols}>
      <div className={s.stack}>
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
            <Input
              label="Tekrar arama hatırlatma saati"
              hint="0 ile 23 arası, yerel saat."
              error={hourErr}
              type="number"
              inputMode="numeric"
              min={0}
              max={23}
              value={hour}
              onChange={(e) => setHour(e.target.value)}
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

      <div className={s.stack}>
        <Card>
          <h2>Gönderim saatleri</h2>
          <div className={s.hours} style={{ marginTop: 12 }}>
            <div>
              <span>Sabah listesi</span>
              <b>{hh(settings.distribution_hour)}</b>
            </div>
            <div>
              <span>Tekrar arama hatırlatması</span>
              <b>{Number.isInteger(hourNum) && !hourErr ? hh(hourNum) : hh(settings.reminder_hour)}</b>
            </div>
            <div>
              <span>Akşam özeti</span>
              <b>{hh(settings.summary_hour)}</b>
            </div>
          </div>
          <p className={s.sub} style={{ marginBottom: 0 }}>
            Sabah ve akşam saatleri Kurallar sekmesinden değişir.
          </p>
        </Card>

        <Card>
          <h2>Ekip bağlantıları</h2>
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
