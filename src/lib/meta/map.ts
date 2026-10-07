export type FieldData = { name?: string; values?: string[] }[];

/** Form sorusu anahtarı (küçük harf) -> Meta soru türü (FULL_NAME, PHONE, ...). */
export type QuestionTypes = Record<string, string>;

export type MappedLead = { fullName: string | null; phone: string | null; operator: string | null; note: string | null };

const NAME_KEYS = new Set(["full_name", "first_name", "last_name"]);
const PHONE_KEYS = new Set(["phone_number", "phone"]);

const clean = (v: string | undefined) => (v ?? "").trim();
const first = (f: { values?: string[] }) => clean((f.values ?? []).find((x) => clean(x) !== ""));

/** Meta telefonu `p:+90...` öneğiyle verebilir. */
export function stripPhonePrefix(v: string): string {
  return v.trim().replace(/^p:/i, "").trim();
}

/** Form sorusunun iç anahtarını (tutar, telefonno, hangi_model) okunaklı etikete çevirir. */
export function prettyLabel(name: string): string {
  const k = name.toLowerCase();
  if (k.includes("tutar")) return "Tutar";
  if (k.includes("telefon") || /^tel(_|\s|$|no)/.test(k)) return "Telefon";
  const plain = name.replace(/[_\s]+/g, " ").trim();
  return plain.charAt(0).toLocaleUpperCase("tr-TR") + plain.slice(1);
}

/** Graph `field_data` -> müşteri alanları. Diğer sorular notta `soru: cevap` biçiminde ` · ` ile birleşir. */
export function mapLead(fieldData: FieldData | undefined | null, types: QuestionTypes = {}): MappedLead {
  const fields = Array.isArray(fieldData) ? fieldData : [];
  const byName = new Map<string, string>();
  const extras: string[] = [];
  let operator: string | null = null;
  for (const f of fields) {
    const name = clean(f?.name);
    if (!name) continue;
    const key = name.toLowerCase();
    // Anahtarlar forma göre özeldir (adi_soyadi, telefon_numarasi ...); asıl ayırt edici soru türüdür.
    const type = types[key];
    const slot = type === "FULL_NAME" ? "full_name" : type === "FIRST_NAME" ? "first_name" : type === "LAST_NAME" ? "last_name" : type === "PHONE" ? "phone_number" : null;
    const canon = slot ?? (NAME_KEYS.has(key) || PHONE_KEYS.has(key) ? key : null);
    if (canon) {
      if (!byName.get(canon)) byName.set(canon, first(f));
      continue;
    }
    const answer = (f.values ?? []).map(clean).filter(Boolean).join(", ");
    // Operatör sorusunun anahtarı forma göre değişir (operator, hangi_operator ...); not yerine Operatör alanına gider.
    if (!operator && answer && /operat[oö]r/i.test(key)) {
      operator = answer;
      continue;
    }
    if (answer) extras.push(`${prettyLabel(name)}: ${answer}`);
  }
  const full = byName.get("full_name") ?? "";
  const joined = [byName.get("first_name"), byName.get("last_name")].filter(Boolean).join(" ");
  const fullName = full || joined || null;
  const rawPhone = byName.get("phone_number") || byName.get("phone") || "";
  const phone = rawPhone ? stripPhonePrefix(rawPhone) : null;
  return { fullName, phone: phone || null, operator, note: extras.length ? extras.join(" · ") : null };
}
