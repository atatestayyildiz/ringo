"use client";

import { useEffect, useState, useTransition } from "react";
import { connectMetaAction, loadMetaAction, syncMetaAction, type MetaData } from "@/app/(app)/ayarlar/meta-actions";
import a from "@/components/ayarlar/ayarlar.module.css";
import s from "@/components/profil/profil.module.css";
import { Button, Card, Chip, useToast } from "@/components/ui";
import { formatWhen } from "@/lib/meta/status";

const ENV_ROWS: { key: keyof MetaData["env"]; label: string; name: string }[] = [
  { key: "appSecret", label: "Uygulama sırrı", name: "META_APP_SECRET" },
  { key: "verifyToken", label: "Doğrulama kodu", name: "META_VERIFY_TOKEN" },
  { key: "accessToken", label: "Erişim anahtarı", name: "META_ACCESS_TOKEN" },
  { key: "pageId", label: "Sayfa kimliği", name: "META_PAGE_ID" },
];

export function MetaPanel() {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [data, setData] = useState<MetaData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () =>
    loadMetaAction().then((res) => {
      if (res.ok) {
        setData(res.data);
        setLoadError(null);
      } else setLoadError(res.error);
    });

  useEffect(() => {
    let live = true;
    void loadMetaAction().then((res) => {
      if (!live) return;
      if (res.ok) setData(res.data);
      else setLoadError(res.error);
    });
    return () => {
      live = false;
    };
  }, []);

  const envReady = data ? Object.values(data.env).every(Boolean) : false;
  const st = data?.status;

  const connect = () =>
    start(async () => {
      const res = await connectMetaAction();
      if (res.ok) toast("Meta bağlantısı kuruldu.");
      else toast(res.error, "error");
      await load();
    });

  const sync = () =>
    start(async () => {
      const res = await syncMetaAction();
      if (res.ok) toast(res.message);
      else toast(res.error, "error");
      await load();
    });

  return (
    <div className={a.cols}>
      <div className={a.stack}>
        <Card>
          <h2>Sunucu ayarları</h2>
          <p className={s.sub}>Değerler burada gösterilmez, yalnız tanımlı olup olmadığı görünür. Kurulum rehberine bakın.</p>
          {loadError ? <div className={s.warn}>{loadError}</div> : null}
          {!data && !loadError ? <p className={s.sub}>Yükleniyor</p> : null}
          {data ? (
            <div className={s.kinds}>
              {ENV_ROWS.map((r) => (
                <div key={r.key} className={s.kind}>
                  <div>
                    <b>{r.label}</b>
                    <small>{r.name}</small>
                  </div>
                  <Chip>{data.env[r.key] ? "Var" : "Yok"}</Chip>
                </div>
              ))}
            </div>
          ) : null}
          {data && !envReady ? <div className={s.warn}>Eksik ayarlar tamamlanmadan bağlantı kurulamaz.</div> : null}
        </Card>
      </div>

      <div className={a.stack}>
        <Card>
          <h2>Bağlantı durumu</h2>
          {st ? (
            <>
              <p className={s.sub}>
                {st.connected
                  ? "Facebook lead formundan gelen başvurular müşteri olarak eklenir."
                  : "Henüz bağlı değil. Sunucu ayarları tamamsa Bağlantıyı kur düğmesine basın."}
              </p>
              <div className={s.kinds}>
                <div className={s.kind}>
                  <div>
                    <b>Bağlantı</b>
                    {st.page_id ? <small>Sayfa {st.page_id}</small> : null}
                  </div>
                  <Chip>{st.connected ? "Bağlı" : "Bağlı değil"}</Chip>
                </div>
                <div className={s.kind}>
                  <div>
                    <b>Son başvuru</b>
                    <small>{formatWhen(st.last_lead_at)}</small>
                  </div>
                </div>
                <div className={s.kind}>
                  <div>
                    <b>Son tarama</b>
                    <small>{formatWhen(st.last_sync_at)}</small>
                  </div>
                </div>
              </div>
              {st.last_error ? (
                <div className={s.warn}>
                  Son hata ({formatWhen(st.last_error_at)}): {st.last_error}
                </div>
              ) : null}
            </>
          ) : null}
          <div className={s.row}>
            <Button variant="brand" onClick={connect} disabled={pending || !envReady}>
              {pending ? "Çalışıyor" : st?.connected ? "Bağlantıyı yenile" : "Bağlantıyı kur"}
            </Button>
            <Button onClick={sync} disabled={pending || !st?.connected}>
              Şimdi tara
            </Button>
          </div>
          <p className={s.sub}>Şimdi tara son 7 günün başvurularını kontrol eder; eklenmiş olanlar tekrar eklenmez. Sistem bunu her 10 dakikada kendisi de yapar.</p>
        </Card>
      </div>
    </div>
  );
}
