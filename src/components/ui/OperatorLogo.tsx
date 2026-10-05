const OPERATORS: Record<string, { name: string; file: string }> = {
  TC: { name: "Turkcell", file: "turkcell" },
  VF: { name: "Vodafone", file: "vodafone" },
  TT: { name: "Türk Telekom", file: "turk-telekom" },
};

/** Operatör logosu (ikon) + isteğe bağlı ad. Bilinmeyen kodda yalnız ad. */
export function OperatorLogo({ operator, showName = true }: { operator: string | null | undefined; showName?: boolean }) {
  if (!operator) return null;
  const op = OPERATORS[operator];
  if (!op) return showName ? <>{operator}</> : null;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/operators/${op.file}.png`}
        width={64}
        height={64}
        alt={showName ? "" : op.name}
        aria-hidden={showName ? true : undefined}
        style={{ display: "inline-block", width: "1em", height: "1em", verticalAlign: "-0.15em", marginRight: showName ? "0.4em" : 0, flex: "none" }}
      />
      {showName ? op.name : null}
    </>
  );
}
