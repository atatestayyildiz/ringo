/**
 * "Kapı açılacak" bayrağı (sessionStorage). Giriş/kilit ekranı kapıyı kapatıp çizgileri çizdikten sonra
 * armDoor() ile yazar ve panele gider; (app) düzenindeki DoorProvider bayrağı görünce kapıyı aynı
 * konumda kapalı başlatır, ilk boyamadan sonra açar ve bayrağı siler. Konum oran olarak saklanır.
 */

import type { EmblemSnapshot } from "./Scene";
import type { Face } from "./parts";

export const DOOR_FLAG = "telefoncu-door";
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
