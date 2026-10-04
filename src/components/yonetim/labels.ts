export const OUTCOME_LABEL: Record<string, string> = {
  appointment: "Dükkana gelecek",
  callback: "Sonra aranacak",
  no_answer: "Açmadı",
  busy: "Meşgul",
  disqualified: "Uygun değil",
  not_interested: "İlgilenmiyor",
  wrong_number: "Yanlış numara",
};

export const STAGE_LABEL: Record<string, string> = {
  appointment: "Dükkana gelecek",
  visited: "Dükkana geldi",
  applied: "Başvurdu",
  approved: "Onaylandı",
  rejected: "Reddedildi",
  completed: "Tamamlandı",
  not_interested: "İlgilenmiyor",
};

/** "Murat Kaya" -> "Murat K." ; tek sözcük olduğu gibi. */
export function shortName(full: string | null | undefined): string {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Müşteri";
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  return `${parts.slice(0, -1).join(" ")} ${last[0].toLocaleUpperCase("tr")}.`;
}

export function firstName(full: string | null | undefined): string {
  return (full ?? "").trim().split(/\s+/)[0] || "Çalışan";
}
