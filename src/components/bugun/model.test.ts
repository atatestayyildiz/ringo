import { describe, expect, it } from "vitest";
import { groupByOrigin, originOf } from "./model";

describe("originOf", () => {
  it("hiç havuza düşmemiş müşteri yeni", () => {
    expect(originOf({ archive: false, status: "pending", poolCount: 0 })).toBe("new");
  });
  it("havuzdan dönen müşteri", () => {
    expect(originOf({ archive: false, status: "retry", poolCount: 1 })).toBe("pool");
  });
  it("bugün havuza düşen yeni müşteri yeni kalır", () => {
    expect(originOf({ archive: false, status: "pool", poolCount: 1 })).toBe("new");
  });
  it("havuzdan dönüp yine havuza düşen müşteri havuzdan dönen kalır", () => {
    expect(originOf({ archive: false, status: "pool", poolCount: 2 })).toBe("pool");
  });
  it("geçmiş dönem müşterisi ayrı", () => {
    expect(originOf({ archive: true, status: "pending", poolCount: 0 })).toBe("archive");
  });
});

describe("groupByOrigin", () => {
  it("yeni, havuz, geçmiş sırasıyla gruplar; grup içi sıra korunur; boş grup yok", () => {
    const list = [
      { id: "a", origin: "pool" as const },
      { id: "b", origin: "new" as const },
      { id: "c", origin: "pool" as const },
      { id: "d", origin: "new" as const },
    ];
    expect(groupByOrigin(list).map((g) => [g.origin, g.items.map((i) => i.id).join("")])).toEqual([
      ["new", "bd"],
      ["pool", "ac"],
    ]);
  });
});
