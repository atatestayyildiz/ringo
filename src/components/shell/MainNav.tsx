"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  IconChart,
  IconFunnel,
  IconGear,
  IconHome,
  IconPool,
  IconUsers,
  type IconProps,
} from "@/components/icons";

export function IconReport(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className="i" aria-hidden="true" focusable="false" {...props}>
      <path d="M6 3h8l5 5v13H6zM14 3v5h5M9.5 13h6M9.5 17h4" />
    </svg>
  );
}

export type NavKey = "bugun" | "musteriler" | "havuz" | "huni" | "yonetim" | "raporlar" | "ayarlar";

export const NAV_ITEMS: { key: NavKey; href: string; label: string; Icon: (p: IconProps) => React.ReactElement }[] = [
  { key: "bugun", href: "/bugun", label: "Bugün", Icon: IconHome },
  { key: "musteriler", href: "/musteriler", label: "Müşteriler", Icon: IconUsers },
  { key: "havuz", href: "/havuz", label: "Havuz", Icon: IconPool },
  { key: "huni", href: "/huni", label: "Huni", Icon: IconFunnel },
  { key: "yonetim", href: "/yonetim", label: "Yönetim", Icon: IconChart },
  { key: "raporlar", href: "/raporlar", label: "Raporlar", Icon: IconReport },
  { key: "ayarlar", href: "/ayarlar", label: "Ayarlar", Icon: IconGear },
];

/** Zaten açık olan menüye tekrar basınca sayfayı yeniler (aynı adres Link için işlem yapmaz). */
export function useNavRefresh() {
  const router = useRouter();
  const path = usePathname();
  return (href: string) => {
    if (path !== href) return;
    router.refresh();
    window.scrollTo({ top: 0 });
  };
}

export function MainNav({ visible }: { visible: NavKey[] }) {
  const path = usePathname();
  const refreshIfCurrent = useNavRefresh();
  return (
    <nav className="nav" aria-label="Ana menü">
      {NAV_ITEMS.filter((i) => visible.includes(i.key)).map(({ key, href, label, Icon }) => {
        const active = path === href || path.startsWith(href + "/");
        return (
          <Link key={key} href={href} aria-current={active ? "page" : undefined} aria-label={label} onClick={() => refreshIfCurrent(href)}>
            <Icon />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
