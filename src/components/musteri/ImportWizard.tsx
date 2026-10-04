"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button, buttonClass, Card, Chip, Input, Select } from "@/components/ui";
import { FIELD_LABELS, guessMapping, validateMapping, type FieldKey, type Mapping } from "@/lib/import/columns";
import { ImportFileError, parseImportFile, type ParsedSheet } from "@/lib/import/parse";
import { chunk, cellToString, prepareRows, type PreparedRow } from "@/lib/import/rows";
import { formatPhone } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import "./musteri.css";
import { toUserMessage } from "@/lib/errors";

const CHUNK = 500;
const FIELD_ORDER: FieldKey[] = ["full_name", "first_name", "last_name", "phone", "phone_alt", "operator", "birth_date", "applied_at", "note"];

type RpcResult = { inserted: number; duplicates: number; invalid: number; invalid_rows: { index: number; reason: string }[] };
type Summary = { inserted: number; duplicates: number; invalid: { sheetRow: number; name: string; phone: string; reason: string }[]; stoppedAt?: string };

type Step = "upload" | "map" | "preview" | "running" | "done";

export function ImportWizard() {
  const [step, setStep] = useState<Step>("upload");
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [fileName, setFileName] = useState("");
  const [map, setMap] = useState<Mapping>({});
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState<Summary | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const mapError = validateMapping(map);
  const prepared = useMemo<PreparedRow[]>(
    () => (sheet && step !== "upload" && !validateMapping(map) ? prepareRows(sheet.rows, map) : []),
    [sheet, map, step],
  );
  const validCount = prepared.filter((r) => r.valid).length;
  const invalidCount = prepared.length - validCount;
  const dupCount = prepared.filter((r) => r.valid && r.duplicateInFile).length;

  const reset = () => {
    setStep("upload");
    setSheet(null);
    setFileName("");
    setMap({});
    setSource("");
    setError(null);
    setSummary(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const parsed = await parseImportFile(file);
      setSheet(parsed);
      setFileName(file.name);
      setSource(file.name);
      setMap(guessMapping(parsed.headers));
      setStep("map");
    } catch (e) {
      setError(e instanceof ImportFileError ? e.message : "Dosya okunamadı. Dosyayı .xlsx veya .csv olarak kaydedip tekrar yükleyin.");
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  const run = async () => {
    const rows = prepared;
    const parts = chunk(rows, CHUNK);
    const sum: Summary = { inserted: 0, duplicates: 0, invalid: [] };
    setSummary(null);
    setStep("running");
    setProgress({ done: 0, total: rows.length });
    const supabase = createClient();
    const label = source.trim() || fileName;
    let offset = 0;
    for (const part of parts) {
      const { data, error: err } = await supabase.rpc("import_customers", {
        p_rows: part.map((r) => r.payload),
        p_source_detail: label,
      });
      if (err) {
        sum.stoppedAt = toUserMessage(err);
        break;
      }
      const r = data as unknown as RpcResult;
      sum.inserted += r.inserted;
      sum.duplicates += r.duplicates;
      for (const bad of r.invalid_rows ?? []) {
        const src = part[bad.index];
        if (src) {
          sum.invalid.push({
            sheetRow: src.sheetRow,
            name: src.payload.full_name,
            phone: src.payload.phone,
            reason: bad.reason,
          });
        }
      }
      offset += part.length;
      setProgress({ done: offset, total: rows.length });
    }
    setSummary(sum);
    setStep("done");
  };

  const steps: [Step | "map", string][] = [
    ["upload", "1. Dosya"],
    ["map", "2. Sütunlar"],
    ["preview", "3. Önizleme"],
    ["done", "4. Sonuç"],
  ];
  const stepIndex = { upload: 0, map: 1, preview: 2, running: 2, done: 3 }[step];

  return (
    <Card>
      <div className="mu-steps" aria-label="Adımlar">
        {steps.map(([k, label], i) => (
          <Chip key={k} aria-current={i === stepIndex ? "step" : undefined} style={i === stepIndex ? { background: "var(--ink)", color: "var(--on-ink)" } : undefined}>
            {label}
          </Chip>
        ))}
      </div>

      {error ? (
        <div className="form-error" role="alert" style={{ marginBottom: 14 }}>
          {error}
        </div>
      ) : null}

      {step === "upload" ? (
        <label
          className="mu-drop"
          data-over={over}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void onFile(e.dataTransfer.files?.[0]);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => void onFile(e.target.files?.[0])}
            aria-label="Dosya seç"
          />
          <b>Dosyayı buraya bırakın veya seçin</b>
          <span>.xlsx veya .csv. İlk satır başlık olmalı. En fazla 10 MB.</span>
          <span className={buttonClass("ink", "sm")}>Dosya seç</span>
        </label>
      ) : null}

      {step === "map" && sheet ? (
        <>
          <p style={{ color: "var(--ink-2)", marginBottom: 14, fontSize: 14 }}>
            <b>{fileName}</b>, {sheet.rows.length} satır. Sütunları kontrol edin; yanlış tahmin varsa değiştirin.
          </p>
          <div className="mu-map">
            {FIELD_ORDER.map((f) => (
              <Select
                key={f}
                label={FIELD_LABELS[f] + (f === "phone" ? " *" : "")}
                value={map[f] == null ? "" : String(map[f])}
                hint={map[f] != null ? `Örnek: ${cellToString(sheet.rows[0]?.[map[f]!]) || "boş"}` : undefined}
                onChange={(e) => {
                  const v = e.target.value;
                  setMap((m) => {
                    const next = { ...m };
                    if (v === "") delete next[f];
                    else next[f] = Number(v);
                    return next;
                  });
                }}
              >
                <option value="">Eşleme yok</option>
                {sheet.headers.map((h, i) => (
                  <option key={i} value={i}>
                    {h}
                  </option>
                ))}
              </Select>
            ))}
          </div>
          <p className="mu-warn" style={{ marginTop: 14 }}>
            Ad soyad ayrı sütunlardaysa &quot;Ad&quot; ve &quot;Soyad&quot; seçin, ikisi birleştirilir. Telefon ve ad zorunludur.
          </p>
          {mapError ? (
            <p className="form-error" role="alert" style={{ marginTop: 12 }}>
              {mapError}
            </p>
          ) : null}
          <div className="mu-bar">
            <Button variant="soft" onClick={reset}>
              Başka dosya
            </Button>
            <Button disabled={Boolean(mapError)} onClick={() => setStep("preview")}>
              Önizleme
            </Button>
          </div>
        </>
      ) : null}

      {step === "preview" && sheet ? (
        <>
          <div className="mu-stats" style={{ marginBottom: 16 }}>
            <div className="mu-stat">
              <b>{validCount}</b>
              <span>Geçerli</span>
            </div>
            <div className="mu-stat">
              <b>{invalidCount}</b>
              <span>Geçersiz</span>
            </div>
            <div className="mu-stat">
              <b>{dupCount}</b>
              <span>Dosyada tekrar</span>
            </div>
          </div>
          <div className="mu-table-wrap">
            <table className="mu-table">
              <thead>
                <tr>
                  <th>Satır</th>
                  <th>Ad soyad</th>
                  <th>Telefon</th>
                  <th>Operatör</th>
                  <th>Doğum</th>
                  <th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {prepared.slice(0, 20).map((r) => (
                  <tr key={r.sheetRow} data-bad={!r.valid}>
                    <td>{r.sheetRow}</td>
                    <td>{r.payload.full_name || "-"}</td>
                    <td>{r.phoneNormalized ? formatPhone(r.phoneNormalized) : r.payload.phone || "-"}</td>
                    <td>{r.payload.operator ?? "-"}</td>
                    <td>{r.payload.birth_date ?? "-"}</td>
                    <td>
                      {r.valid ? (
                        <span className="st" data-s={r.duplicateInFile ? "pool" : "done"}>
                          {r.duplicateInFile ? "Dosyada tekrar" : "Geçerli"}
                        </span>
                      ) : (
                        <span className="st" data-s="bad">
                          {r.reason}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ color: "var(--ink-3)", fontSize: 12.5, marginTop: 8 }}>
            İlk {Math.min(20, prepared.length)} satır gösteriliyor, toplam {prepared.length}. Sistemde zaten kayıtlı numaralar
            aktarım sırasında mükerrer sayılır ve eklenmez.
          </p>
          <div style={{ marginTop: 16, maxWidth: 420 }}>
            <Input
              label="Kaynak açıklaması"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              hint="Müşterilerin kaynağı olarak kaydedilir."
            />
          </div>
          <div className="mu-bar">
            <Button variant="soft" onClick={() => setStep("map")}>
              Geri
            </Button>
            <Button variant="brand" disabled={validCount === 0} onClick={run}>
              {validCount} müşteriyi içe aktar
            </Button>
          </div>
        </>
      ) : null}

      {step === "running" ? (
        <div role="status" aria-live="polite">
          <p style={{ marginBottom: 10, fontWeight: 600 }}>
            Aktarılıyor, {progress.done} / {progress.total}
          </p>
          <div className="mu-progress">
            <i style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
          <p style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 10 }}>Sayfayı kapatmayın.</p>
        </div>
      ) : null}

      {step === "done" && summary ? (
        <>
          {summary.stoppedAt ? (
            <div className="form-error" role="alert" style={{ marginBottom: 14 }}>
              Aktarım yarıda kesildi: {summary.stoppedAt} Aşağıdaki sayılar kesilmeden önce işlenenleri gösterir. Aynı dosyayı
              tekrar yükleyebilirsiniz; kayıtlı numaralar mükerrer sayılıp atlanır.
            </div>
          ) : null}
          <div className="mu-stats">
            <div className="mu-stat">
              <b>{summary.inserted}</b>
              <span>Eklendi</span>
            </div>
            <div className="mu-stat">
              <b>{summary.duplicates}</b>
              <span>Mükerrer</span>
            </div>
            <div className="mu-stat">
              <b>{summary.invalid.length}</b>
              <span>Geçersiz</span>
            </div>
          </div>
          {summary.invalid.length > 0 ? (
            <div style={{ marginTop: 18 }}>
              <h3 style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-3)", marginBottom: 8 }}>Geçersiz satırlar</h3>
              <div className="mu-table-wrap">
                <table className="mu-table">
                  <thead>
                    <tr>
                      <th>Satır</th>
                      <th>Ad soyad</th>
                      <th>Telefon</th>
                      <th>Neden</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.invalid.map((r) => (
                      <tr key={r.sheetRow}>
                        <td>{r.sheetRow}</td>
                        <td>{r.name || "-"}</td>
                        <td>{r.phone || "-"}</td>
                        <td>{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          <p className="mu-warn" style={{ marginTop: 16 }}>
            Eklenen müşteriler bir sonraki dağıtımda çalışanların listesine girer.
          </p>
          <div className="mu-bar">
            <Button variant="soft" onClick={reset}>
              Yeni dosya
            </Button>
            <Link href="/musteriler" className={buttonClass("ink")}>
              Müşterilere git
            </Link>
          </div>
        </>
      ) : null}
    </Card>
  );
}
