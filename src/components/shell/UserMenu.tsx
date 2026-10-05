"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { IconLogout, IconMoon, IconSun } from "@/components/icons";
import { useLock } from "@/components/lock/useLock";
import { Avatar } from "@/components/ui";
import { IconLock } from "./IconLock";
import { SignOutDialog } from "./SignOutButton";
import { useThemeToggle } from "./ThemeToggle";
import s from "./UserMenu.module.css";

function IconUser() {
  return (
    <svg viewBox="0 0 24 24" className="i" aria-hidden="true" focusable="false">
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

function IconChevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className ? `i ${className}` : "i"} aria-hidden="true" focusable="false">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

type Item = { key: string; label: string; icon: ReactNode; run: () => void; keepOpen?: boolean };

/**
 * Hesap menüsü: avatar tetikleyici; açılınca altına alt alta bağımsız yuvarlak düğmeler
 * (Profil, tema, Paneli kilitle, Çıkış yap). Menü düğmesi kalıbı: ok tuşları, Home/End, Escape,
 * dışarı tıklayınca kapanma, odak tetikleyiciye döner.
 */
export function UserMenu({
  name,
  roleLabel,
  signOutAction,
}: {
  name: string;
  roleLabel: string;
  signOutAction: () => void | Promise<void>;
}) {
  const router = useRouter();
  const { dark, toggle } = useThemeToggle();
  const { lockNow } = useLock();
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const focusOnOpen = useRef<"first" | "last">("first");
  const menuId = useId();

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  };

  const items: Item[] = [
    { key: "profil", label: "Profil", icon: <IconUser />, run: () => router.push("/profil") },
    {
      key: "tema",
      label: dark ? "Açık tema" : "Koyu tema",
      icon: dark ? <IconSun /> : <IconMoon />,
      run: toggle,
      keepOpen: true,
    },
    { key: "kilit", label: "Paneli kilitle", icon: <IconLock />, run: () => void lockNow() },
    { key: "cikis", label: "Çıkış yap", icon: <IconLogout />, run: () => setConfirmOpen(true) },
  ];

  const menuItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (!open) return;
    const list = menuItems();
    (focusOnOpen.current === "last" ? list[list.length - 1] : list[0])?.focus();
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    const list = menuItems();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => list[(n + list.length) % list.length]?.focus();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      go(i + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      go(i - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      go(0);
    } else if (e.key === "End") {
      e.preventDefault();
      go(list.length - 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      focusOnOpen.current = e.key === "ArrowUp" ? "last" : "first";
      setOpen(true);
    }
  };

  return (
    <div className={s.root} ref={rootRef}>
      <div
        className={open ? `${s.scrim} ${s.scrimOn}` : s.scrim}
        aria-hidden="true"
        data-testid="user-menu-scrim"
        onPointerDown={(e) => {
          e.preventDefault();
          close();
        }}
      />
      <button
        ref={btnRef}
        type="button"
        className={`me ${s.trigger}`}
        aria-label="Hesap menüsü"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          focusOnOpen.current = "first";
          setOpen((v) => !v);
        }}
        onKeyDown={onTriggerKey}
      >
        <Avatar name={name} />
        <div>
          <small>{roleLabel}</small>
          <b>{name}</b>
        </div>
        <IconChevron className={s.chev} />
      </button>
      {open ? (
        <ul id={menuId} ref={menuRef} className={s.menu} role="menu" aria-label="Hesap" onKeyDown={onMenuKey}>
          {items.map((it, i) => (
            <li key={it.key} role="none">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={s.item}
                style={{ "--i": i } as React.CSSProperties}
                onClick={() => {
                  if (!it.keepOpen) close(it.key !== "cikis" && it.key !== "profil");
                  it.run();
                }}
              >
                <span className={s.label}>{it.label}</span>
                <span className={s.icon}>{it.icon}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <SignOutDialog
        open={confirmOpen}
        onClose={() => {
          setConfirmOpen(false);
          btnRef.current?.focus();
        }}
        action={signOutAction}
      />
    </div>
  );
}
