// Saf mesaj üreticileri: payload -> Türkçe, HTML-güvenli metin. İsimler ve linkler kaçışlanır.

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

/** "2026-10-04" -> "4 Ekim" */
export function trDate(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month}` : escapeHtml(day);
}

const e = escapeHtml;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function link(appUrl: string | undefined, path: string): string {
  const base = (appUrl ?? "").trim().replace(/\/+$/, "");
  return base ? `${base}${path}` : "";
}

export type MorningPayload = {
  first_name?: string;
  total?: number;
  retries?: number;
  new?: number;
  birthdays?: { full_name?: string; days_left?: number }[];
};

export function morningText(p: MorningPayload, appUrl?: string): string {
  let t = `Günaydın ${e(str(p.first_name))}. Bugün ${num(p.total)} kişi aranacak: ${num(p.retries)} tekrar arama, ${num(p.new)} yeni.`;
  const bd = (p.birthdays ?? []).filter((b) => str(b.full_name));
  if (bd.length > 0) {
    const parts = bd.map((b) => {
      const d = num(b.days_left);
      return `${e(str(b.full_name))} (${d <= 0 ? "bugün" : `${d} gün`})`;
    });
    t += ` Doğum günü yaklaşan: ${parts.join(", ")}.`;
  }
  const url = link(appUrl, "/bugun");
  return url ? `${t} Listeyi aç: ${e(url)}` : t;
}

export type SummaryPayload = {
  day?: string;
  totals?: { assigned?: number; done?: number; reached?: number; appointments?: number; retries?: number };
  members?: { full_name?: string; assigned?: number; done?: number; appointments?: number }[];
};

const MAX_SUMMARY_MEMBERS = 12;

export function summaryText(p: SummaryPayload, appUrl?: string): string {
  const t = p.totals ?? {};
  let text = `Bugünün özeti (${trDate(str(p.day))}): ${num(t.assigned)} atama, ${num(t.done)} tamamlandı, ${num(t.reached)} ulaşıldı, ${num(t.appointments)} randevu, ${num(t.retries)} tekrar.`;
  const members = (p.members ?? []).filter((m) => str(m.full_name));
  if (members.length > 0) {
    const shown = members.slice(0, MAX_SUMMARY_MEMBERS).map((m) => {
      const first = str(m.full_name).trim().split(/\s+/)[0];
      return `${e(first)} ${num(m.done)}/${num(m.assigned)} (${num(m.appointments)} randevu)`;
    });
    const rest = members.length - shown.length;
    text += ` ${shown.join(", ")}${rest > 0 ? ` ve ${rest} kişi daha` : ""}.`;
  }
  const url = link(appUrl, "/raporlar");
  return url ? `${text} Ayrıntı: ${e(url)}` : text;
}

export function linkedText(fullName: string, tenantName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  return `Bağlantı kuruldu. Merhaba ${e(first)}, bu sohbet ${e(tenantName)} hesabına bağlandı. Günlük bildirimler buraya gelecek. Tercihlerini uygulamada Profil sayfasından değiştirebilirsin.`;
}

export function linkFailedText(reason: string | undefined): string {
  if (reason === "expired") return "Kodun süresi dolmuş. Uygulamada Profil sayfasından yeni bir kod üret.";
  if (reason === "used") return "Bu kod daha önce kullanılmış. Uygulamada Profil sayfasından yeni bir kod üret.";
  return "Kod geçersiz. Uygulamada Profil sayfasından yeni bir kod üretip /start KOD şeklinde yaz.";
}

export function helpText(appUrl?: string): string {
  const base = "Merhaba. Hesabını bağlamak için uygulamada Profil sayfasından bağlama kodu üret, sonra bana /start KOD yaz.";
  const url = link(appUrl, "/profil");
  return url ? `${base} Profil: ${e(url)}` : base;
}

export function testText(firstName: string): string {
  return `${e(firstName)}, test mesajı ulaştı. Bildirimler bu sohbete gelecek.`;
}

export type TargetKind = "morning" | "summary";

/** `_notification_targets` satırı -> metin. */
export function notificationText(kind: TargetKind, payload: unknown, appUrl?: string): string {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  if (kind === "morning") return morningText(p as MorningPayload, appUrl);
  return summaryText(p as SummaryPayload, appUrl);
}
