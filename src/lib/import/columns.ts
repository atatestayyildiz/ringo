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

export type Mapping = Partial<Record<FieldKey, number>>;

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
      exact: ["ad soyad", "adsoyad", "ad soyadi", "isim", "isim soyisim", "musteri", "musteri adi", "full name", "name"],
      prefix: ["ad soyad", "isim"],
    },
  ],
  ["first_name", { exact: ["ad", "adi", "first name"] }],
  [
    "phone",
    {
      exact: ["telefon", "tel", "gsm", "numara", "cep", "cep telefonu", "telefon numarasi", "phone", "mobil"],
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
