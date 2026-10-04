import { NextResponse, type NextRequest } from "next/server";
import { csvDate, csvDateTime, fileDay, toCsv, type CsvCell } from "@/lib/csv";
import { toUserMessage } from "@/lib/errors";
import { formatPhone } from "@/lib/format";
import { OPERATOR_LABEL, STAGE_LABEL } from "@/components/musteri/shared";
import { STATUS_INFO, type CallStatus } from "@/components/ui";
import { authorizeExport, csvResponse } from "../_auth";

export const dynamic = "force-dynamic";

const MAX_ROWS = 10_000;
const CHUNK = 1000;

/** Müşteriler sayfasındaki temizleme ile aynı: or() filtresini bozan karakterleri atar. */
function cleanTerm(s: string): string {
  return s.replace(/[,()\\"%*_:]/g, " ").replace(/\s+/g, " ").trim();
}

const COLUMNS =
  "id, full_name, phone, phone_alt, operator, birth_date, call_status, pipeline_stage, assigned_to, last_note, source, source_detail, applied_at, created_at";

export async function GET(req: NextRequest) {
  const auth = await authorizeExport();
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const sp = req.nextUrl.searchParams;
  const q = cleanTerm(sp.get("q") ?? "");
  const durum = sp.get("durum") ?? "";
  const asama = sp.get("asama") ?? "";
  const operator = sp.get("operator") ?? "";
  const atanan = sp.get("atanan") ?? "";

  // Filtreler hem veri hem sayım sorgusunda aynı
  const applyFilters = <T extends { or: (f: string) => T; eq: (c: string, v: string) => T; is: (c: string, v: null) => T }>(
    query: T,
  ): T => {
    if (q) {
      let digits = q.replace(/\D/g, "");
      if (digits.startsWith("90") && digits.length >= 6) digits = digits.slice(2);
      const hasLetters = /[\p{L}]/u.test(q);
      const parts: string[] = [];
      if (hasLetters || digits.length < 3) parts.push(`full_name.ilike.%${q}%`);
      if (digits.length >= 3 && !hasLetters) {
        parts.push(`phone.ilike.%${digits}%`, `phone_alt.ilike.%${digits}%`);
      } else if (digits.length >= 3) {
        parts.push(`phone.ilike.%${digits}%`);
      }
      query = query.or(parts.join(","));
    }
    if (durum) query = query.eq("call_status", durum);
    if (asama === "yok") query = query.is("pipeline_stage", null);
    else if (asama) query = query.eq("pipeline_stage", asama);
    if (operator === "yok") query = query.is("operator", null);
    else if (operator) query = query.eq("operator", operator);
    if (atanan === "yok") query = query.is("assigned_to", null);
    else if (atanan) query = query.eq("assigned_to", atanan);
    return query;
  };
  const build = () =>
    applyFilters(supabase.from("customers").select(COLUMNS)).order("created_at", { ascending: false }).order("id");

  type Row = {
    id: string;
    full_name: string;
    phone: string;
    phone_alt: string | null;
    operator: string | null;
    birth_date: string | null;
    call_status: string;
    pipeline_stage: string | null;
    assigned_to: string | null;
    last_note: string | null;
    source: string;
    source_detail: string | null;
    applied_at: string | null;
    created_at: string | null;
  };

  const rows: Row[] = [];
  // Sunucunun sayfa sınırı CHUNK'tan küçük olsa da eksik satır kalmasın: dönen sayı kadar ilerle, boş gelince dur.
  while (rows.length < MAX_ROWS) {
    const from = rows.length;
    const { data, error } = await build().range(from, Math.min(from + CHUNK, MAX_ROWS) - 1);
    if (error) return NextResponse.json({ error: toUserMessage(error) }, { status: 500 });
    if (!data?.length) break;
    rows.push(...(data as Row[]));
  }

  // Sınıra ulaşıldıysa toplamı al: kesildiyse başlıkla bildir
  let total = rows.length;
  if (rows.length >= MAX_ROWS) {
    const { count, error } = await applyFilters(supabase.from("customers").select("id", { count: "exact", head: true }));
    if (error) return NextResponse.json({ error: toUserMessage(error) }, { status: 500 });
    total = Math.max(count ?? rows.length, rows.length);
  }
  const truncated = total > rows.length;

  const { data: memberRows } = await supabase.from("members").select("id, full_name");
  const names = new Map((memberRows ?? []).map((m) => [m.id, m.full_name]));

  const header: CsvCell[] = [
    "Ad Soyad",
    "Telefon",
    "Operatör",
    "Durum",
    "Aşama",
    "Atanan",
    "Kaynak",
    "Başvuru",
    "Doğum Tarihi",
    "Son Not",
    "Oluşturma",
  ];
  const body: CsvCell[][] = rows.map((c) => [
    c.full_name,
    formatPhone(c.phone),
    c.operator ? (OPERATOR_LABEL[c.operator] ?? c.operator) : "",
    STATUS_INFO[c.call_status as CallStatus]?.label ?? c.call_status,
    c.pipeline_stage ? (STAGE_LABEL[c.pipeline_stage] ?? c.pipeline_stage) : "",
    c.assigned_to ? (names.get(c.assigned_to) ?? "") : "",
    c.source_detail?.trim() || c.source,
    csvDateTime(c.applied_at),
    csvDate(c.birth_date),
    c.last_note ?? "",
    csvDateTime(c.created_at),
  ]);

  const filters: Record<string, string> = {};
  for (const [k, v] of Object.entries({ q, durum, asama, operator, atanan })) if (v) filters[k] = v;
  const { error: logError } = await supabase.rpc("log_export", { p_kind: "customers", p_rows: rows.length, p_filters: filters });
  if (logError) return NextResponse.json({ error: toUserMessage(logError) }, { status: 500 });

  return csvResponse(
    toCsv([header, ...body]),
    `musteriler-${fileDay()}.csv`,
    truncated ? { "X-Export-Truncated": "1", "X-Export-Total": String(total) } : undefined,
  );
}
