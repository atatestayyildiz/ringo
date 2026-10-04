import { NextResponse, type NextRequest } from "next/server";
import { csvDate, csvPercent, fileDay, toCsv, type CsvCell } from "@/lib/csv";
import { toUserMessage } from "@/lib/errors";
import { can } from "@/lib/session";
import { isValidDay, daysBetween, MAX_DAYS } from "@/components/raporlar/range";
import { OPERATOR_NAME, OUTCOME_NAME, normalizeReport, ratio } from "@/components/raporlar/types";
import { authorizeExport, csvResponse } from "../_auth";

export const dynamic = "force-dynamic";

const bad = (msg: string) => NextResponse.json({ error: msg }, { status: 400 });

export async function GET(req: NextRequest) {
  // Rapor CSV'si her zaman ekip geneli: export + view_reports (yetkisiz çalışan kendi kapsamını da indiremez)
  const auth = await authorizeExport((m) => can(m, "view_reports"), "Raporları görme yetkiniz yok.");
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (!isValidDay(from) || !isValidDay(to) || to < from) return bad("Tarih aralığı geçersiz.");
  if (daysBetween(from, to) + 1 > MAX_DAYS) return bad(`Aralık en fazla ${MAX_DAYS} gün olabilir.`);

  const { data, error } = await supabase.rpc("report_range", { p_from: from, p_to: to });
  if (error) return NextResponse.json({ error: toUserMessage(error) }, { status: error.code === "42501" ? 403 : 500 });
  const r = normalizeReport(data);
  // Savunma: DB ekip kapsamı vermediyse dosya üretilmez
  if (r.scope !== "team") return NextResponse.json({ error: "Raporları görme yetkiniz yok." }, { status: 403 });
  const t = r.totals;

  const rows: CsvCell[][] = [];
  const section = (title: string, header: CsvCell[], body: CsvCell[][]) => {
    if (rows.length) rows.push([]);
    rows.push([title]);
    rows.push(header);
    rows.push(...body);
  };

  section("Rapor aralığı", ["Başlangıç", "Bitiş"], [[csvDate(from), csvDate(to)]]);
  section(
    "Özet",
    ["Gösterge", "Değer"],
    [
      ["Atanan", t.assigned],
      ["Aranan müşteri", t.customers_called],
      ["Deneme", t.attempts],
      ["Ulaşılan deneme", t.reached],
      ["Ulaşma oranı", csvPercent(r.rates.reach_rate)],
      ["Randevu", t.appointments],
      ["Randevu oranı (ulaşılanlardan)", csvPercent(r.rates.appointment_rate)],
      ["Geldi", t.visited],
      ["Geliş oranı (randevudan)", csvPercent(r.rates.visit_rate)],
      ["Başvuru", t.applied],
      ["Onay", t.approved],
      ["İşlem tamam", t.completed],
      ["Tamamlanma oranı (randevudan)", csvPercent(r.rates.close_rate)],
      ["Reddedilen", t.rejected],
      ["İlgilenmeyen", t.not_interested],
      ["Uygun değil", t.disqualified],
      ["Havuza düşen", t.pooled],
      ["Ulaşılamadı", t.unreachable],
      ["Yeni müşteri", t.new_customers],
    ],
  );
  section(
    "Çalışanlar",
    ["Çalışan", "Deneme", "Ulaşılan", "Ulaşma oranı", "Randevu", "İşlem tamam"],
    r.by_member.map((m) => [m.full_name, m.attempts, m.reached, csvPercent(ratio(m.reached, m.attempts)), m.appointments, m.completed]),
  );
  section(
    "Günlük",
    ["Gün", "Deneme", "Ulaşılan", "Randevu"],
    r.by_day.map((d) => [csvDate(d.day), d.attempts, d.reached, d.appointments]),
  );
  section(
    "Arama sonuçları",
    ["Sonuç", "Adet"],
    r.by_outcome.map((o) => [OUTCOME_NAME[o.outcome] ?? o.outcome, o.count]),
  );
  section(
    "Kaynak performansı",
    ["Kaynak", "Müşteri", "Randevu", "Tamam", "Dönüşüm"],
    r.by_source.map((x) => [x.source_detail, x.customers, x.appointments, x.completed, csvPercent(ratio(x.completed, x.customers))]),
  );
  section(
    "Operatör",
    ["Operatör", "Müşteri", "Tamam", "Dönüşüm"],
    r.by_operator.map((x) => [OPERATOR_NAME[x.operator] ?? x.operator, x.customers, x.completed, csvPercent(ratio(x.completed, x.customers))]),
  );

  const { error: logError } = await supabase.rpc("log_export", {
    p_kind: "report",
    p_rows: rows.length,
    p_filters: { from, to },
  });
  if (logError) return NextResponse.json({ error: toUserMessage(logError) }, { status: 500 });

  return csvResponse(toCsv(rows), `rapor-${from}_${to}-${fileDay()}.csv`);
}
