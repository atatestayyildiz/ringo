import { normalizeTrPhone } from "./phone";
import { cellToString, type Cell } from "./rows";

export type FieldKey =
  | "first_name"
  | "last_name"
  | "full_name"
  | "phone"
  | "phone_alt"
  | "operator"
  | "birth_date"
  | "applied_at"
  | "note";

export type Mapping = Partial<Record<FieldKey, number>> & {
  /** Nota birleştirilecek ek sütunlar (ana Not sütunuyla birlikte). */
  extraNotes?: number[];
};

export const FIELD_LABELS: Record<FieldKey, string> = {
  full_name: "Ad soyad",
  first_name: "Ad",
  last_name: "Soyad",
  phone: "Telefon",
  phone_alt: "İkinci telefon",
  operator: "Operatör",
  birth_date: "Doğum tarihi",
  applied_at: "Başvuru tarihi",
  note: "Not",
};

/** Başlığı karşılaştırma için sadeleştirir: Türkçe küçük harf, aksansız, yalnız harf/rakam/boşluk. */
export function normalizeHeader(h: string): string {
  return String(h ?? "")
    .toLocaleLowerCase("tr")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type Rule = { exact: string[]; prefix?: string[] };

/** Sıra önemlidir: önce belirgin olanlar eşleşir, kullanılan sütun tekrar alınmaz. */
const RULES: [FieldKey, Rule][] = [
  ["last_name", { exact: ["soyad", "soyadi", "last name", "surname"] }],
  [
    "phone_alt",
    {
      exact: ["telefon 2", "tel 2", "gsm 2", "ikinci telefon", "alternatif telefon", "alternatif"],
      prefix: ["alternatif", "ikinci"],
    },
  ],
  [
    "full_name",
    {
      exact: [
        "ad soyad", "adsoyad", "ad soyadi", "isim", "isim soyisim", "musteri", "musteri adi", "full name", "name",
        "adiniz soyadiniz", "adi soyadi", "ad ve soyad", "adiniz ve soyadiniz",
      ],
      prefix: ["ad soyad", "isim"],
    },
  ],
  ["first_name", { exact: ["ad", "adi", "first name"] }],
  [
    "phone",
    {
      exact: [
        "telefon", "tel", "gsm", "numara", "cep", "cep telefonu", "telefon numarasi", "phone", "mobil",
        "phone number", "mobile", "mobile phone", "telephone", "telefon no", "cep no", "telefon numaraniz", "cep telefonu numaraniz",
      ],
      prefix: ["telefon", "gsm", "numara", "cep"],
    },
  ],
  ["operator", { exact: ["operator", "hat", "operatoru"], prefix: ["operator"] }],
  ["birth_date", { exact: ["dogum tarihi", "dogum", "dogum gunu", "birth date", "birthday"], prefix: ["dogum"] }],
  [
    "applied_at",
    { exact: ["tarih", "basvuru", "basvuru tarihi", "created time", "created at"], prefix: ["basvuru", "tarih"] },
  ],
  ["note", { exact: ["not", "notlar", "aciklama", "yorum", "note", "notes"], prefix: ["not", "aciklama"] }],
];

/** Başlıklardan alan -> sütun indeksi tahmini. */
export function guessMapping(headers: string[]): Mapping {
  const norm = headers.map(normalizeHeader);
  const used = new Set<number>();
  const map: Mapping = {};

  const take = (field: FieldKey, idx: number) => {
    map[field] = idx;
    used.add(idx);
  };

  // 1. geçiş: tam eşleşme
  for (const [field, rule] of RULES) {
    const idx = norm.findIndex((h, i) => !used.has(i) && rule.exact.includes(h));
    if (idx >= 0) take(field, idx);
  }
  // 2. geçiş: sözcük başı eşleşme (henüz eşleşmemiş alanlar için)
  for (const [field, rule] of RULES) {
    const prefixes = rule.prefix;
    if (map[field] != null || !prefixes) continue;
    const idx = norm.findIndex(
      (h, i) => !used.has(i) && h !== "" && h.split(" ").some((tok) => prefixes.some((p) => tok.startsWith(p))),
    );
    if (idx >= 0) take(field, idx);
  }

  // "İsim" + "Soyad" birlikteyse isim sütunu aslında addır
  if (map.last_name != null && map.first_name == null && map.full_name != null) {
    map.first_name = map.full_name;
    delete map.full_name;
  }
  // Ad ve soyad ayrı geldiyse tam ad sütunu gereksiz
  if (map.first_name != null && map.last_name != null) delete map.full_name;

  return map;
}

/** Eşleme geçerli mi? Telefon ve (ad soyad veya ad) zorunlu. Hata metni ya da null. */
export function validateMapping(map: Mapping): string | null {
  if (map.phone == null) return "Telefon sütununu seçin.";
  if (map.full_name == null && map.first_name == null) return "Ad soyad (veya ad) sütununu seçin.";
  return null;
}

const OPERATOR_RE = /^(vf|tc|tt|avea|vodaf\p{L}*|turkc\p{L}*|t[uü]rkc\p{L}*|\p{L}*telekom)$/iu;
const isOperatorWord = (v: string) => OPERATOR_RE.test(v.replace(/\s+/g, ""));
const NAME_RE = /^\p{L}[\p{L} .'’?-]+$/u;

/**
 * Başlıksız dosyalar için sütun içeriğinden tahmin: çoğunluğu telefon olan sütun telefon,
 * operatör adı olan sütun operatör, soldaki ilk metin sütunu ad soyad; dolu kalan diğer sütunlar nota
 * (ilki ana not, sonrakiler ek not) bağlanır.
 */
export function guessMappingFromContent(rows: Cell[][]): Mapping {
  const sample = rows.slice(0, 200);
  const width = Math.max(0, ...sample.map((r) => r.length));
  const stats = Array.from({ length: width }, (_, i) => {
    const vals = sample.map((r) => cellToString(r[i])).filter((v) => v !== "");
    const n = vals.length || 1;
    return {
      i,
      filled: vals.length / (sample.length || 1),
      phone: vals.filter((v) => normalizeTrPhone(v)).length / n,
      op: vals.filter(isOperatorWord).length / n,
      name: vals.filter((v) => NAME_RE.test(v) && !isOperatorWord(v)).length / n,
    };
  });
  const map: Mapping = {};
  const used = new Set<number>();
  const best = (key: "phone" | "op") =>
    stats.filter((s) => s[key] >= 0.6 && !used.has(s.i)).sort((a, b) => b[key] - a[key] || a.i - b.i)[0];
  const ph = best("phone");
  if (ph) {
    map.phone = ph.i;
    used.add(ph.i);
  }
  const op = best("op");
  if (op) {
    map.operator = op.i;
    used.add(op.i);
  }
  const nm = stats.find((s) => !used.has(s.i) && s.name >= 0.6 && s.filled >= 0.5);
  if (nm) {
    map.full_name = nm.i;
    used.add(nm.i);
  }
  const notes = stats.filter((s) => !used.has(s.i) && s.filled >= 0.2).map((s) => s.i);
  if (notes.length) {
    map.note = notes[0];
    if (notes.length > 1) map.extraNotes = notes.slice(1, 4);
  }
  return map;
}
