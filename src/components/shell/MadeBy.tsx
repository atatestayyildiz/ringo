"use client";

import s from "./MadeBy.module.css";

const SITE = "https://moonworks.com.tr";

/**
 * Yüklü uygulamada (PWA, standalone) dış bağlantı uygulamanın içinde bir pencerede açılır ve panel ekranı bozulur.
 * Burada bağlantı cihazın kendi tarayıcısına verilir: Android'de intent, iOS'ta x-safari-https. Bir saniye içinde
 * uygulama arka plana geçmediyse (şema desteklenmedi) normal yeni sekme açılır. Tarayıcıda bu işe karışılmaz.
 */
function openInBrowser(e: React.MouseEvent<HTMLAnchorElement>) {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (!standalone) return;
  const ua = navigator.userAgent;
  let target: string | null = null;
  if (/Android/i.test(ua)) {
    target = `intent://${SITE.replace("https://", "")}/#Intent;scheme=https;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(SITE)};end`;
  } else if (/iPhone|iPad|iPod/i.test(ua)) {
    target = SITE.replace("https://", "x-safari-https://");
  }
  if (!target) return;
  e.preventDefault();
  window.location.href = target;
  window.setTimeout(() => {
    if (document.visibilityState === "visible") window.open(SITE, "_blank", "noopener,noreferrer");
  }, 1000);
}

/**
 * Sabit üretici imzası. Müşterinin mağaza markası değildir ve tenant_settings'ten gelmez;
 * CLAUDE.md'deki "marka kodda sabit yazılmaz" kuralı mağaza markası içindir, bu imza istisnadır.
 */
export function MadeBy() {
  return (
    <div className={s.madeby}>
      <span className={s.product}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ringo-64.png" alt="" aria-hidden="true" width={16} height={16} />
        Ringo bir
      </span>
      <a
        className={s.link}
        href={SITE}
        target="_blank"
        rel="noopener noreferrer"
        onClick={openInBrowser}
        aria-label="MoonWorks web sitesi (tarayıcıda açılır)"
      >
        {/* eslint-disable @next/next/no-img-element */}
        <img className={s.light} src="/moonworks-logo.png" alt="MoonWorks" width={118} height={15} />
        <img className={s.dark} src="/moonworks-logo-dark.png" alt="" aria-hidden="true" width={118} height={15} />
        {/* eslint-enable @next/next/no-img-element */}
        <span>ürünüdür</span>
      </a>
    </div>
  );
}
