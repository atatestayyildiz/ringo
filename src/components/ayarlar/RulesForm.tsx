"use client";

import { useState, useTransition } from "react";
import { saveRulesAction } from "@/app/(app)/ayarlar/actions";
import { Button, Card, Input, Select, useToast } from "@/components/ui";
import type { TenantSettings } from "@/lib/session";
import {
  DISTRIBUTION_MODES,
  MODE_LABEL,
  RULE_LIMITS,
  checkRule,
  modeSummary,
  rulesSummary,
  type DistributionMode,
} from "./shared";
import s from "./ayarlar.module.css";

type NumKey = Exclude<keyof typeof RULE_LIMITS, "claim_limit">;

const FIELDS: { key: NumKey; label: string; hint: string }[] = [
  { key: "max_attempts", label: "Tur başına deneme", hint: "Başarısız arama sayısı. Dolunca müşteri havuza düşer." },
  { key: "pool_wait_days", label: "Havuzda bekleme (gün)", hint: "Havuza düşen müşteri bu kadar gün sonra döner." },
  { key: "max_rounds", label: "Havuza düşme sınırı", hint: "Bu sayıdan sonra müşteri ulaşılamadı olarak kapanır." },
  { key: "birthday_notice_days", label: "Doğum günü uyarısı (gün)", hint: "Doğum gününe kaç gün kala listede görünsün." },
];

export function RulesForm({ settings, summary }: { settings: TenantSettings; summary: string }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [vals, setVals] = useState<Record<NumKey, string>>({
    max_attempts: String(settings.max_attempts),
    pool_wait_days: String(settings.pool_wait_days),
    max_rounds: String(settings.max_rounds),
    birthday_notice_days: String(settings.birthday_notice_days),
  });
  const [mode, setMode] = useState<DistributionMode>(
    DISTRIBUTION_MODES.includes(settings.distribution_mode as DistributionMode)
      ? (settings.distribution_mode as DistributionMode)
      : "auto_even",
  );
  const [claimRaw, setClaimRaw] = useState(String(settings.claim_limit));
  const [saved, setSaved] = useState(summary);

  const errors: Partial<Record<NumKey, string>> = {};
  const nums = {} as Record<NumKey, number>;
  for (const f of FIELDS) {
    const raw = vals[f.key].trim();
    const n = raw === "" ? NaN : Number(raw);
    nums[f.key] = n;
    const e = checkRule(f.key, n);
    if (e) errors[f.key] = e;
  }
  const claimNum = claimRaw.trim() === "" ? NaN : Number(claimRaw.trim());
  // Sınır yalnız serbest havuzda görünür; diğer modda alan gizliyken kayıtlı değer korunur
  const claimError = mode === "free_pool" ? checkRule("claim_limit", claimNum) : null;
  const claimValue = mode === "free_pool" ? claimNum : settings.claim_limit;
  const valid = Object.keys(errors).length === 0 && !claimError;
  const liveOk = !errors.max_attempts && !errors.pool_wait_days && !errors.max_rounds;

  const save = () => {
    if (!valid) {
      toast("Kırmızı işaretli alanları düzeltin.", "error");
      return;
    }
    start(async () => {
      const res = await saveRulesAction({ ...nums, claim_limit: claimValue, distribution_mode: mode });
      if (res.ok) {
        setSaved(res.summary);
        toast("Kurallar kaydedildi.");
      } else {
        toast(res.error, "error");
      }
    });
  };

  return (
    <div className={s.cols}>
      <Card>
        <h2>Arama kuralları</h2>
        <div className={s.formGrid}>
          {FIELDS.map((f) => (
            <Input
              key={f.key}
              label={f.label}
              hint={f.hint}
              error={errors[f.key]}
              type="number"
              inputMode="numeric"
              min={RULE_LIMITS[f.key][0]}
              max={RULE_LIMITS[f.key][1]}
              value={vals[f.key]}
              onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
            />
          ))}
          <div className={s.full}>
            <Select
              label="Dağıtım yöntemi"
              value={mode}
              onChange={(e) => setMode(e.target.value as DistributionMode)}
            >
              {DISTRIBUTION_MODES.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m]}
                </option>
              ))}
            </Select>
            <p className={s.modeNote}>Yeni gelen müşterilerin çalışanlara nasıl ulaşacağını belirler.</p>
          </div>
          {mode === "free_pool" ? (
            <Input
              label="Aynı anda en fazla açık müşteri"
              hint="Çalışan listesinde bu kadar aranmamış müşteri varken yenisini alamaz."
              error={claimError ?? undefined}
              type="number"
              inputMode="numeric"
              min={RULE_LIMITS.claim_limit[0]}
              max={RULE_LIMITS.claim_limit[1]}
              value={claimRaw}
              onChange={(e) => setClaimRaw(e.target.value)}
            />
          ) : null}
        </div>
        <div className={s.actions}>
          <Button variant="brand" onClick={save} disabled={pending}>
            {pending ? "Kaydediliyor" : "Kaydet"}
          </Button>
        </div>
      </Card>

      <div className={s.stack}>
        <Card>
          <h2>Canlı önizleme</h2>
          <div className={`${s.summary} ${s.summaryLive}`} aria-live="polite">
            {liveOk
              ? rulesSummary({
                  max_attempts: nums.max_attempts,
                  pool_wait_days: nums.pool_wait_days,
                  max_rounds: nums.max_rounds,
                })
              : "Geçerli sayılar girince kural özeti burada görünür."}
          </div>
          <h2 style={{ marginTop: 16 }}>{MODE_LABEL[mode]}</h2>
          <div className={`${s.summary} ${s.summaryLive}`} aria-live="polite" data-testid="mode-summary">
            {modeSummary(mode, claimError ? settings.claim_limit : claimValue)}
          </div>
        </Card>
        <Card>
          <h2>Kayıtlı kurallar</h2>
          <p className={s.summary} data-testid="rules-saved">
            {saved}
          </p>
        </Card>
      </div>
    </div>
  );
}
