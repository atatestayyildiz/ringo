import { describe, expect, it } from "vitest";
import { activePreset, parseRange, presetRange } from "./range";

describe("rapor aralığı", () => {
  it("hafta pazartesi başlar", () => {
    expect(presetRange("week", "2026-10-04")).toEqual({ from: "2026-09-28", to: "2026-10-04" }); // pazar
    expect(presetRange("week", "2026-10-05")).toEqual({ from: "2026-10-05", to: "2026-10-05" }); // pazartesi
  });
  it("ay ve geçen ay", () => {
    expect(presetRange("month", "2026-10-04")).toEqual({ from: "2026-10-01", to: "2026-10-04" });
    expect(presetRange("lastmonth", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
  it("parseRange varsayılan, geçerli ve geçersiz", () => {
    expect(parseRange(undefined, undefined, "2026-10-04")).toEqual({ from: "2026-10-01", to: "2026-10-04", error: null });
    expect(parseRange("2026-09-01", "2026-09-30", "2026-10-04").error).toBeNull();
    expect(parseRange("2026-02-31", "2026-03-01", "2026-10-04").error).not.toBeNull();
    expect(parseRange("2026-09-30", "2026-09-01", "2026-10-04").error).not.toBeNull();
    expect(parseRange("2025-01-01", "2026-01-02", "2026-10-04").error).not.toBeNull(); // 367 gün
    expect(parseRange("2025-01-01", "2025-12-31", "2026-10-04").error).toBeNull(); // 365 gün
  });
  it("etkin hazır seçim", () => {
    expect(activePreset("2026-10-01", "2026-10-04", "2026-10-04")).toBe("month");
    expect(activePreset("2026-10-02", "2026-10-03", "2026-10-04")).toBe("custom");
  });
});
