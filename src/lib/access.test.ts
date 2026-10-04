import { describe, expect, it } from "vitest";
import { can, canExportReport, canViewTeam, canViewTeamReports, navKeys } from "./access";

const manager = { role: "manager", permissions: {} };
const agent = { role: "agent", permissions: {} };
const reports = { role: "agent", permissions: { view_reports: true } };
const team = { role: "agent", permissions: { view_team: true } };
const both = { role: "agent", permissions: { view_reports: true, view_team: true } };
const exportOnly = { role: "agent", permissions: { export: true } };
const exportReports = { role: "agent", permissions: { export: true, view_reports: true } };

describe("menü ve sayfa erişimi (rol x Raporlar/Yönetim)", () => {
  it("Raporlar herkese açık", () => {
    for (const m of [manager, agent, reports, team, both, exportOnly]) expect(navKeys(m)).toContain("raporlar");
  });

  it("Yönetim yalnız yönetici veya view_team", () => {
    expect(navKeys(manager)).toContain("yonetim");
    expect(navKeys(team)).toContain("yonetim");
    expect(navKeys(both)).toContain("yonetim");
    expect(navKeys(agent)).not.toContain("yonetim");
    expect(navKeys(reports)).not.toContain("yonetim");
    expect(canViewTeam(reports)).toBe(false);
    expect(canViewTeam(team)).toBe(true);
  });

  it("view_reports tek başına Yönetim açmaz, view_team tek başına ekip raporu açmaz", () => {
    expect(canViewTeamReports(reports)).toBe(true);
    expect(canViewTeam(reports)).toBe(false);
    expect(canViewTeamReports(team)).toBe(false);
    expect(canViewTeamReports(agent)).toBe(false);
    expect(canViewTeamReports(manager)).toBe(true);
  });

  it("Ayarlar yalnız yönetici", () => {
    expect(navKeys(manager)).toContain("ayarlar");
    for (const m of [agent, reports, team, both]) expect(navKeys(m)).not.toContain("ayarlar");
  });

  it("rapor CSV'si export ve view_reports ister", () => {
    expect(canExportReport(manager)).toBe(true);
    expect(canExportReport(exportReports)).toBe(true);
    expect(canExportReport(exportOnly)).toBe(false);
    expect(canExportReport(reports)).toBe(false);
    expect(canExportReport(agent)).toBe(false);
  });

  it("yetki varsayılanı false; yalnız true değeri sayılır", () => {
    expect(can({ role: "agent", permissions: null }, "view_team")).toBe(false);
    expect(can({ role: "agent", permissions: { view_team: "true" } }, "view_team")).toBe(false);
    expect(can({ role: "agent", permissions: { view_team: 1 } }, "view_team")).toBe(false);
    expect(can(manager, "view_team")).toBe(true);
  });
});
