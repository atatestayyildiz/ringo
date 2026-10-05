/**
 * "Kapı açılacak" bayrağı (sessionStorage). Giriş/kilit ekranı kapıyı kapatıp çizgileri çizdikten sonra
 * armDoor() ile yazar ve panele gider; (app) düzenindeki DoorProvider bayrağı görünce kapıyı aynı
 * konumda kapalı başlatır, ilk boyamadan sonra açar ve bayrağı siler. Konum oran olarak saklanır.
 */

import type { EmblemSnapshot } from "./Scene";
import type { Face } from "./parts";

export const DOOR_FLAG = "telefoncu-door";

/**
 * Bu belgede istemci gezinmesi var mı (bir sahne ya da panel en az bir kez boyandı). Tam sayfa
 * yüklemede (adres çubuğu, yenileme) false: kalmış bayrak kapı oynatmaz, sayfa hemen kullanılır.
 */
export const docState = { painted: false };
const MAX_AGE_MS = 15_000;

export type DoorFlag = {
  t: number;
  /** Amblem merkezi ve kenarı, görünür alan oranı olarak (en, boy). */
  fx: number;
  fy: number;
  fs: number;
  stage: "closed" | "lines";
  face: Face;
};

export function armDoor(geom: EmblemSnapshot, face: Face, stage: DoorFlag["stage"] = "lines") {
  const W = innerWidth || 1;
  const H = innerHeight || 1;
  const flag: DoorFlag = { t: Date.now(), fx: geom.cx / W, fy: geom.cy / H, fs: geom.size / Math.min(W, H), stage, face };
  try {
    sessionStorage.setItem(DOOR_FLAG, JSON.stringify(flag));
  } catch {
    // depolama kapalı: kapı oynamaz, panel doğrudan açılır
  }
}

export function readDoorFlagRaw(): string | null {
  try {
    return sessionStorage.getItem(DOOR_FLAG);
  } catch {
    return null;
  }
}

export function clearDoorFlag() {
  try {
    sessionStorage.removeItem(DOOR_FLAG);
  } catch {
    // yok say
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Ham bayrağı doğrular; eski ya da bozuksa null. */
export function parseDoorFlag(raw: string | null): DoorFlag | null {
  if (!raw) return null;
  try {
    const f = JSON.parse(raw) as Partial<DoorFlag>;
    const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
    if (!num(f.t) || Date.now() - (f.t as number) > MAX_AGE_MS) return null;
    if (!num(f.fx) || !num(f.fy) || !num(f.fs) || !f.face || typeof f.face.name !== "string") return null;
    const color = typeof f.face.color === "string" && HEX.test(f.face.color) ? f.face.color : null;
    const logo = typeof f.face.logo === "string" && /^https?:\/\//.test(f.face.logo) ? f.face.logo : null;
    return {
      t: f.t as number,
      fx: f.fx as number,
      fy: f.fy as number,
      fs: f.fs as number,
      stage: f.stage === "closed" ? "closed" : "lines",
      face: { name: f.face.name.slice(0, 80), color, logo },
    };
  } catch {
    return null;
  }
}

export function flagGeom(f: DoorFlag): EmblemSnapshot {
  return { cx: f.fx * innerWidth, cy: f.fy * innerHeight, size: f.fs * Math.min(innerWidth, innerHeight) };
}

/* ---------- kilit: kapı panelde kapanır, /kilit sahnesi aynı konumdan devralır ---------- */

const ARRIVAL = "telefoncu-door-arrival";
const LOCK_EMBLEM = "telefoncu-lock-emblem";

type Frac = { t: number; fx: number; fy: number; fs: number };

function toFrac(g: EmblemSnapshot): Frac {
  const W = innerWidth || 1;
  const H = innerHeight || 1;
  return { t: Date.now(), fx: g.cx / W, fy: g.cy / H, fs: g.size / Math.min(W, H) };
}

function fromFrac(raw: string | null, maxAge: number): EmblemSnapshot | null {
  if (!raw) return null;
  try {
    const f = JSON.parse(raw) as Partial<Frac>;
    const ok = [f.t, f.fx, f.fy, f.fs].every((v) => typeof v === "number" && Number.isFinite(v));
    if (!ok || Date.now() - (f.t as number) > maxAge) return null;
    return { cx: (f.fx as number) * innerWidth, cy: (f.fy as number) * innerHeight, size: (f.fs as number) * Math.min(innerWidth, innerHeight) };
  } catch {
    return null;
  }
}

function store(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // depolama kapalı: hizalama varsayılana düşer
  }
}

function load(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Kapı kapandı: /kilit sahnesi amblemini bu konumdan kendi yerine taşır, giriş koreografisini atlar. */
export function armArrival(geom: EmblemSnapshot) {
  store(ARRIVAL, JSON.stringify(toFrac(geom)));
}
export const readArrivalRaw = () => load(ARRIVAL);
export const parseArrival = (raw: string | null) => fromFrac(raw, 15_000);
export const clearArrival = () => store(ARRIVAL, null);

/** /kilit amblemi gerçek konumu (oran); sonraki kapanış bu konuma kapanır. */
export function saveLockEmblem(geom: EmblemSnapshot) {
  store(LOCK_EMBLEM, JSON.stringify({ ...toFrac(geom), vw: innerWidth, vh: innerHeight }));
}

/** Kapanış için amblem konumu: kayıtlı /kilit ölçüsü (aynı pencere boyunda) ya da yerleşimden tahmin. */
export function lockEmblemGuess(): EmblemSnapshot {
  const raw = load(LOCK_EMBLEM);
  try {
    const f = raw ? (JSON.parse(raw) as { vw?: number; vh?: number }) : null;
    if (f && f.vw === innerWidth && f.vh === innerHeight) {
      const g = fromFrac(raw, Number.POSITIVE_INFINITY);
      if (g) return g;
    }
  } catch {
    // tahmine düş
  }
  return guessLockEmblem(innerWidth, innerHeight);
}

/** scene.module.css kilit yerleşiminin yaklaşık modeli (ölçü yoksa); küçük sapmayı varış FLIP'i kapatır. */
export function guessLockEmblem(W: number, H: number): EmblemSnapshot {
  const vmin = Math.min(W, H);
  const size = Math.max(124, Math.min(184, vmin * 0.16 + 64));
  const content = W < 561 ? 516 : 548; // başlık + kart (noktalar, tuş takımı) + bağlantı
  const total = size + 26 + 18 + content;
  const top = Math.max(56, (H - total) / 2);
  return { cx: W / 2, cy: top + size / 2, size };
}
