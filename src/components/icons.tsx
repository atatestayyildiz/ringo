import type { ReactNode, SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement>;

function make(name: string, children: ReactNode) {
  const Icon = ({ className, ...rest }: IconProps) => (
    <svg
      viewBox="0 0 24 24"
      className={className ? `i ${className}` : "i"}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
  Icon.displayName = name;
  return Icon;
}

export const IconSun = make("IconSun", (
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </>
));
export const IconMoon = make("IconMoon", <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />);
export const IconBell = make("IconBell", (
  <>
    <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </>
));
export const IconPhone = make("IconPhone", (
  <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
));
export const IconHome = make("IconHome", (
  <>
    <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
  </>
));
export const IconUsers = make("IconUsers", (
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6" />
  </>
));
export const IconPool = make("IconPool", (
  <path d="M3 9c2 0 2-1.5 4.5-1.5S10 9 12 9s2.5-1.5 4.5-1.5S19 9 21 9M3 14c2 0 2-1.5 4.5-1.5S10 14 12 14s2.5-1.5 4.5-1.5S19 14 21 14M3 19c2 0 2-1.5 4.5-1.5S10 19 12 19s2.5-1.5 4.5-1.5S19 19 21 19" />
));
export const IconFunnel = make("IconFunnel", <path d="M3 4h18l-7 9v6l-4 2v-8z" />);
export const IconChart = make("IconChart", <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />);
export const IconGear = make("IconGear", (
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </>
));
export const IconArrow = make("IconArrow", <path d="M7 17 17 7M8 7h9v9" />);
export const IconChat = make("IconChat", <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z" />);
export const IconCheck = make("IconCheck", <path d="m5 12.5 4.5 4.5L19 7.5" />);
export const IconClock = make("IconClock", (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>
));
export const IconX = make("IconX", <path d="M6 6l12 12M18 6 6 18" />);
export const IconStore = make("IconStore", (
  <path d="M4 9 5.5 4h13L20 9M4 9v11h16V9M4 9c0 2 1.5 3 3 3s3-1 3-3c0 2 1.5 3 3 3s3-1 3-3c0 2 1.5 3 3 3" />
));
export const IconAlert = make("IconAlert", <path d="M12 3 2 20h20zM12 10v4M12 17.5v.01" />);
export const IconCake = make("IconCake", (
  <path d="M4 20h16v-7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2zM4 16c2 0 2 1.5 4 1.5s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M12 11V7M12 4v.01" />
));
export const IconInfo = make("IconInfo", (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8v.01" />
  </>
));
export const IconBrush = make("IconBrush", (
  <>
    <path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2 0-1.6-1.3-1.8-1.3-3 0-1 .8-1.5 1.8-1.5H17a4 4 0 0 0 4-4A8 8 0 0 0 12 3z" />
    <circle cx="7.5" cy="11" r=".6" />
    <circle cx="10" cy="7.5" r=".6" />
    <circle cx="14.5" cy="7.5" r=".6" />
  </>
));
export const IconLogout = make("IconLogout", <path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M16 8l4 4-4 4M20 12H9" />);
