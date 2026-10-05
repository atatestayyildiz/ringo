import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { initials } from "@/lib/format";
import { IconInfo } from "@/components/icons";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/* ---------- Card ---------- */
export function Card({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={cx("card", className)} {...rest} />;
}

/* ---------- Button ---------- */
type Variant = "ink" | "soft" | "brand";
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "md" | "sm";
  block?: boolean;
};
export function buttonClass(variant: Variant = "ink", size: "md" | "sm" = "md", block = false, extra?: string) {
  return cx("btn", `btn-${variant}`, size === "sm" && "btn-sm", block && "btn-block", extra);
}
export function Button({ variant = "ink", size = "md", block, className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, block, className)} {...rest} />;
}
/** Bağlantı görünümlü hap buton (tel:, rota). */
export function ButtonLink({
  href,
  variant = "ink",
  size = "md",
  block,
  className,
  children,
  ...rest
}: Omit<HTMLAttributes<HTMLAnchorElement>, "children"> & {
  href: string;
  variant?: Variant;
  size?: "md" | "sm";
  block?: boolean;
  children: ReactNode;
}) {
  const cls = buttonClass(variant, size, block, className);
  if (/^(tel:|https?:|mailto:)/.test(href)) {
    return (
      <a href={href} className={cls} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls} {...rest}>
      {children}
    </Link>
  );
}

/* ---------- RoundButton (aria-label zorunlu) ---------- */
export function RoundButton({
  label,
  className,
  type = "button",
  children,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & { label: string }) {
  return (
    <button type={type} className={cx("round", className)} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

/* ---------- Chip ---------- */
export function Chip({ className, color, style, ...rest }: HTMLAttributes<HTMLSpanElement> & { color?: string }) {
  return <span className={cx("chip", className)} style={color ? { color, ...style } : style} {...rest} />;
}

/* ---------- StatusBadge ---------- */
export type CallStatus = "pending" | "retry" | "pool" | "done" | "unreachable" | "disqualified";

export const STATUS_INFO: Record<CallStatus, { label: string; tone: "wait" | "retry" | "done" | "bad" | "pool" }> = {
  pending: { label: "Bekliyor", tone: "wait" },
  retry: { label: "Tekrar ara", tone: "retry" },
  pool: { label: "Havuzda", tone: "pool" },
  done: { label: "Tamamlandı", tone: "done" },
  unreachable: { label: "Ulaşılamadı", tone: "bad" },
  disqualified: { label: "Uygun değil", tone: "bad" },
};

export function StatusBadge({ status, className }: { status: CallStatus; className?: string }) {
  const info = STATUS_INFO[status] ?? STATUS_INFO.pending;
  return (
    <span className={cx("st", className)} data-s={info.tone}>
      {info.label}
    </span>
  );
}

/* ---------- Avatar ---------- */
const AVATAR_COLORS = ["#3D7BFF", "#8B5CF6", "#16A765", "#E5484D", "#F59E0B", "#0EA5A0", "#EC4899", "#6B7685"];
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
export function Avatar({
  name,
  size,
  radius,
  className,
  color,
}: {
  name: string;
  size?: number;
  radius?: number | string;
  className?: string;
  /** Zemin rengi (CSS değeri); verilmezse addan türetilir. Oturum sahibinde: "var(--brand)" (kişisel vurgu). */
  color?: string;
}) {
  return (
    <span
      className={cx("avatar", className)}
      aria-hidden="true"
      style={{
        background: color ?? avatarColor(name),
        ...(size ? { width: size, height: size, fontSize: Math.round(size * 0.36) } : {}),
        ...(radius !== undefined ? { borderRadius: radius } : {}),
      }}
    >
      {initials(name)}
    </span>
  );
}

/* ---------- Segmented ---------- */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- EmptyState ---------- */
export function EmptyState({
  title,
  children,
  icon,
  action,
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="ico hatch">{icon ?? <IconInfo />}</span>
      <b>{title}</b>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}
