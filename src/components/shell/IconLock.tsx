/** Asma kilit simgesi (hesap menüsü ve mobil menü). */
export function IconLock({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className ? `i ${className}` : "i"} aria-hidden="true" focusable="false">
      <rect x="5" y="11" width="14" height="10" rx="2.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3M12 15v2" />
    </svg>
  );
}
