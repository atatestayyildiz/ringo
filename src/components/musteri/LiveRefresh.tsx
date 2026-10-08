"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

/** Ardışık değişiklikler (toplu Meta aktarımı, çoklu düzenleme) tek yenilemede toplanır. */
const DEBOUNCE_MS = 2500;
/** İki yenileme arasındaki en kısa süre (Vercel çağrı sayısını sınırlar). */
const MIN_GAP_MS = 5000;
/** Canlı bağlantı yokken (Realtime kapalı ya da koptu) yedek yoklama; yalnız sekme görünürken. */
const FALLBACK_POLL_MS = 60_000;
/** Sekme uzun süre arkada kaldıysa öne gelince veriyi tazele. */
const STALE_MS = 30_000;

/**
 * Müşteriler sayfasını canlı tutar: yeni başvuru ya da değişiklik gelince liste kendiliğinden yenilenir.
 *
 * Kota dostu: değişiklik bildirimi Supabase Realtime (tarayıcıdan doğrudan websocket) ile gelir, bu yüzden
 * bekleyen sayfa Vercel'e hiç istek atmaz. Yalnızca değişiklik olunca debounce'lu tek bir router.refresh()
 * (sunucu bileşeni) çalışır. Gelen olaylar RLS'ten geçer: kullanıcı yalnız görebildiği müşterilerin olayını alır.
 * Sekme gizliyken yenileme ertelenir, öne gelince yapılır. Realtime yoksa 60 sn'lik yedek yoklama devreye girer.
 */
export function LiveRefresh() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let timer: number | undefined;
    let lastRun = 0;
    let dirty = false;
    let live = false;
    let stopped = false;

    const run = () => {
      if (stopped) return;
      if (document.visibilityState !== "visible") {
        dirty = true;
        return;
      }
      dirty = false;
      lastRun = Date.now();
      router.refresh();
    };
    const schedule = () => {
      window.clearTimeout(timer);
      const wait = Math.max(DEBOUNCE_MS, lastRun + MIN_GAP_MS - Date.now());
      timer = window.setTimeout(run, wait);
    };

    const channel = supabase.channel("live-customers");
    void (async () => {
      // Kanalın JWT'si oturumdan alınır; yoksa olaylar RLS'te süzülüp boş gelir.
      const { data } = await supabase.auth.getSession();
      if (stopped) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel
        .on("postgres_changes", { event: "*", schema: "public", table: "customers" }, schedule)
        .subscribe((status) => {
          live = status === "SUBSCRIBED";
        });
    })();

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (dirty || Date.now() - lastRun > STALE_MS) run();
    };
    document.addEventListener("visibilitychange", onVisible);

    const poll = window.setInterval(() => {
      if (!live && document.visibilityState === "visible") run();
    }, FALLBACK_POLL_MS);

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
