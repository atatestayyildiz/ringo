import { describe, expect, it } from "vitest";
import { SYNC_COOLDOWN_TEXT, syncCooldownError } from "./cooldown";

const now = new Date("2026-10-07T12:00:00Z");
describe("syncCooldownError", () => {
  it("2 dakikadan yeni tarama reddedilir", () => {
    expect(syncCooldownError("2026-10-07T11:59:30Z", now)).toBe(SYNC_COOLDOWN_TEXT);
    expect(syncCooldownError("2026-10-07T12:00:00Z", now)).toBe(SYNC_COOLDOWN_TEXT);
  });
  it("2 dakikadan eski, hiç taranmamış ya da bozuk tarih geçer", () => {
    expect(syncCooldownError("2026-10-07T11:57:59Z", now)).toBeNull();
    expect(syncCooldownError(null, now)).toBeNull();
    expect(syncCooldownError("bozuk", now)).toBeNull();
  });
});
