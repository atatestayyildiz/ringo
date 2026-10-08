import { describe, expect, it } from "vitest";
import { normalizeReport } from "@/components/raporlar/types";
import { ARCHIVE_CLAIM_MAX, normalizeArchive } from "./shared";

describe("geçmiş dönem", () => {
  it("archive_list sonucunu güvenle çözer", () => {
    expect(normalizeArchive(null)).toEqual({ total: 0, rows: [] });
    expect(normalizeArchive({ total: 3, rows: "x" })).toEqual({ total: 3, rows: [] });
    expect(normalizeArchive({ total: 1, rows: [{ id: "a" }] }).rows).toHaveLength(1);
  });

  it("rapor archive bloğu yoksa sıfır döner (eski sunucu yanıtı)", () => {
    const r = normalizeReport({ scope: "team", totals: {} });
    expect(r.archive).toEqual({ claimed: 0, attempts: 0, customers_called: 0, reached: 0, appointments: 0, completed: 0, by_member: [] });
  });

  it("rapor archive bloğunu taşır", () => {
    const r = normalizeReport({ scope: "member", archive: { claimed: 4, attempts: 9, reached: 2, by_member: [{ member_id: "m" }] } });
    expect(r.archive.claimed).toBe(4);
    expect(r.archive.attempts).toBe(9);
    expect(r.archive.by_member).toHaveLength(1);
  });

  it("alma sınırı veritabanındaki ile aynı (10)", () => {
    expect(ARCHIVE_CLAIM_MAX).toBe(10);
  });
});
