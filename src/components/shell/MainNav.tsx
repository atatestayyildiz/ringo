"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconChart,
  IconFunnel,
  IconGear,
  IconHome,
  IconPool,
  IconUsers,
  type IconProps,
} from "@/components/icons";

export type NavKey = "bugun" | "musteriler" | "havuz" | "huni" | "yonetim" | "ayarlar";

const ITEMS: { key: NavKey; href: string; label: string; Icon: (p: IconProps) => React.ReactElement }[] = [
  { key: "bugun", href: "/bugun", label: "Bugün", Icon: IconHome },
  { key: "musteriler", href: "/musteriler", label: "Müşteriler", Icon: IconUsers },
  { key: "havuz", href: "/havuz", label: "Havuz", Icon: IconPool },
  { key: "huni", href: "/huni", label: "Huni", Icon: IconFunnel },
  { key: "yonetim", href: "/yonetim", label: "Yönetim", Icon: IconChart },
  { key: "ayarlar", href: "/ayarlar", label: "Ayarlar", Icon: IconGear },
];

export function MainNav({ visible }: { visible: NavKey[] }) {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Ana menü">
      {ITEMS.filter((i) => visible.includes(i.key)).map(({ key, href, label, Icon }) => {
        const active = path === href || path.startsWith(href + "/");
        return (
          <Link key={key} href={href} aria-current={active ? "page" : undefined} aria-label={label}>
            <Icon />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
