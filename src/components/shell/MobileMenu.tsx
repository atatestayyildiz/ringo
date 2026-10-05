"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { IconLogout, IconX } from "@/components/icons";
import { useLock } from "@/components/lock/useLock";
import { IconLock } from "./IconLock";
import { NAV_ITEMS, type NavKey } from "./MainNav";
import { SignOutDialog } from "./SignOutButton";

const FOCUSABLE = "a[href],button:not([disabled])";
const DESKTOP_MQ = "(min-width: 1181px)";

function IconMenu() {
  return (
    <svg viewBox="0 0 24 24" className="i" aria-hidden="true" focusable="false">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg viewBox="0 0 24 24" className="i" aria-hidden="true" focusable="false">
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

/** Mobil (1180px ve altı) yazılı menü çekmecesi. Masaüstünde CSS ile gizli. */
export function MobileMenu({
  visible,
  signOutAction,
}: {
  visible: NavKey[];
  signOutAction: () => void | Promise<void>;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const { lockNow } = useLock();

  useEffect(() => {
    if (!open) return;
    const btn = btnRef.current;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const node = panelRef.current;
    const first = node?.querySelector<HTMLElement>('a[aria-current="page"]') ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const a = items[0];
      const z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    const mq = matchMedia(DESKTOP_MQ);
    const onMq = () => {
      if (mq.matches) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    mq.addEventListener("change", onMq);
    return () => {
      document.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onMq);
      document.body.style.overflow = prevOverflow;
      btn?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="round menu-btn"
        aria-label="Menüyü aç"
        title="Menü"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <IconMenu />
      </button>
      {open ? (
        <div
          className="drawer-wrap"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div id={panelId} ref={panelRef} className="drawer" role="dialog" aria-modal="true" aria-label="Menü" tabIndex={-1}>
            <div className="drawer-head">
              <b>Menü</b>
              <button type="button" className="round" aria-label="Menüyü kapat" onClick={() => setOpen(false)}>
                <IconX />
              </button>
            </div>
            <nav aria-label="Sayfa menüsü" className="drawer-nav">
              {NAV_ITEMS.filter((i) => visible.includes(i.key)).map(({ key, href, label, Icon }) => {
                const active = path === href || path.startsWith(href + "/");
                return (
                  <Link key={key} href={href} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}>
                    <Icon />
                    <span>{label}</span>
                  </Link>
                );
              })}
              <hr />
              <Link
                href="/profil"
                aria-current={path === "/profil" || path.startsWith("/profil/") ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                <IconUser />
                <span>Profil</span>
              </Link>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  void lockNow();
                }}
              >
                <IconLock />
                <span>Paneli kilitle</span>
              </button>
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => {
                  setOpen(false);
                  setConfirmOpen(true);
                }}
              >
                <IconLogout />
                <span>Çıkış yap</span>
              </button>
            </nav>
          </div>
        </div>
      ) : null}
      <SignOutDialog open={confirmOpen} onClose={() => setConfirmOpen(false)} action={signOutAction} />
    </>
  );
}
