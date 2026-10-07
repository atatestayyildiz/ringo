export type FieldData = { name?: string; values?: string[] }[];

export type MappedLead = { fullName: string | null; phone: string | null; note: string | null };

const NAME_KEYS = new Set(["full_name", "first_name", "last_name"]);
const PHONE_KEYS = new Set(["phone_number", "phone"]);

const clean = (v: string | undefined) => (v ?? "").trim();
const first = (f: { values?: string[] }) => clean((f.values ?? []).find((x) => clean(x) !== ""));

/** Meta telefonu `p:+90...` öneğiyle verebilir. */
export function stripPhonePrefix(v: string): string {
  return v.trim().replace(/^p:/i, "").trim();
}

/** Graph `field_data` -> müşteri alanları. Diğer sorular notta `soru: cevap` biçiminde ` · ` ile birleşir. */
export function mapLead(fieldData: FieldData | undefined | null): MappedLead {
  const fields = Array.isArray(fieldData) ? fieldData : [];
  const byName = new Map<string, string>();
  const extras: string[] = [];
  for (const f of fields) {
    const name = clean(f?.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (NAME_KEYS.has(key) || PHONE_KEYS.has(key)) {
      if (!byName.has(key)) byName.set(key, first(f));
      continue;
    }
    const answer = (f.values ?? []).map(clean).filter(Boolean).join(", ");
    if (answer) extras.push(`${name}: ${answer}`);
  }
  const full = byName.get("full_name") ?? "";
  const joined = [byName.get("first_name"), byName.get("last_name")].filter(Boolean).join(" ");
  const fullName = full || joined || null;
  const rawPhone = byName.get("phone_number") || byName.get("phone") || "";
  const phone = rawPhone ? stripPhonePrefix(rawPhone) : null;
  return { fullName, phone: phone || null, note: extras.length ? extras.join(" · ") : null };
}
