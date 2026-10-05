import s from "./MadeBy.module.css";

/**
 * Sabit üretici imzası. Müşterinin mağaza markası değildir ve tenant_settings'ten gelmez;
 * CLAUDE.md'deki "marka kodda sabit yazılmaz" kuralı mağaza markası içindir, bu imza istisnadır.
 */
export function MadeBy() {
  return (
    <div className={s.madeby}>
      <span className={s.product}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ringo-logo.png" alt="" aria-hidden="true" width={16} height={16} />
        Ringo
      </span>
      <a
        className={s.link}
        href="https://moonworks.com.tr"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="MoonWorks web sitesi (yeni sekmede açılır)"
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
