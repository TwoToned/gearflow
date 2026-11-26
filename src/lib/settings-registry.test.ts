import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  SETTINGS,
  SETTINGS_GROUPS,
  hiddenSettings,
  searchSettings,
  settingsEntryForPath,
  settingsGateOpen,
  visibleSettings,
  type SettingsCaps,
} from "@/lib/settings-registry";
import { settingsStatus } from "@/lib/settings-status";

const NONE: SettingsCaps = {
  orgSettingsRead: false,
  orgMembersRead: false,
  checkItemRead: false,
  projectManageLineItems: false,
  xeroManage: false,
};
const ADMIN: SettingsCaps = { ...NONE, orgSettingsRead: true, orgMembersRead: true, checkItemRead: true, projectManageLineItems: true, xeroManage: true };

describe("settings registry", () => {
  it("has a page.tsx for every entry, and every settings page is an entry (drift)", () => {
    const root = join(process.cwd(), "src/app/(app)/settings");
    const dirs = readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory() && d !== "__tests__");
    const onDisk = dirs.filter((d) => readdirSync(join(root, d)).includes("page.tsx")).map((d) => `/settings/${d}`);
    expect(onDisk.sort()).toEqual(SETTINGS.map((e) => e.href).sort());
  });

  it("keys, hrefs and groups are unique and known", () => {
    expect(new Set(SETTINGS.map((e) => e.key)).size).toBe(SETTINGS.length);
    expect(new Set(SETTINGS.map((e) => e.href)).size).toBe(SETTINGS.length);
    const groups = new Set(SETTINGS_GROUPS.map((g) => g.key));
    for (const e of SETTINGS) expect(groups.has(e.group)).toBe(true);
  });

  it("an entry the role cannot open is absent, and named in the hidden list", () => {
    const manager: SettingsCaps = { ...NONE, orgMembersRead: true };
    expect(visibleSettings(manager).map((e) => e.key)).toEqual(["team"]);
    expect(hiddenSettings(manager).map((e) => e.key)).not.toContain("team");
    expect(visibleSettings(ADMIN)).toHaveLength(SETTINGS.length);
    expect(hiddenSettings(ADMIN)).toHaveLength(0);
  });

  it("Xero needs its own capability, not orgSettings", () => {
    expect(settingsGateOpen("xero", { ...ADMIN, xeroManage: false })).toBe(false);
    expect(visibleSettings({ ...ADMIN, xeroManage: false }).some((e) => e.key === "xero")).toBe(false);
  });

  it("search matches the parts inside pages: `tax` finds General's neighbours, Billing, Services and Xero", () => {
    const keys = searchSettings(SETTINGS, "tax").map((e) => e.key);
    expect(keys).toEqual(expect.arrayContaining(["billing", "services", "xero"]));
    expect(searchSettings(SETTINGS, "  ")).toHaveLength(SETTINGS.length);
    expect(searchSettings(SETTINGS, "kill switch").map((e) => e.key)).toEqual(["danger-zone"]);
    expect(searchSettings(SETTINGS, "zzzz")).toEqual([]);
  });

  it("invoice numbering and the default tax rate are findable on Billing, not General (D60)", () => {
    expect(searchSettings(SETTINGS, "invoice numbering").map((e) => e.key)).toContain("billing");
    expect(searchSettings(SETTINGS, "invoice numbering").map((e) => e.key)).not.toContain("general");
    expect(searchSettings(SETTINGS, "default tax rate").map((e) => e.key)).not.toContain("general");
  });

  it("maps a pathname to its entry: longest prefix, the index is none", () => {
    expect(settingsEntryForPath("/settings")).toBeNull();
    expect(settingsEntryForPath("/settings/general")?.key).toBe("general");
    expect(settingsEntryForPath("/settings/test-and-tag/profiles/x")?.key).toBe("test-and-tag");
  });
});

describe("settings status words", () => {
  const none = { team: null, xero: null, mira: null };
  it("prints nothing until the fact has loaded", () => {
    expect(settingsStatus("team", none)).toBeNull();
    expect(settingsStatus("xero", none)).toBeNull();
    expect(settingsStatus("mira", none)).toBeNull();
  });
  it("derives Team, Xero and Mira words", () => {
    expect(settingsStatus("team", { ...none, team: { members: 1, invitations: 0 } })?.label).toBe("1 member");
    expect(settingsStatus("team", { ...none, team: { members: 5, invitations: 2 } })?.label).toBe("5 members · 2 invited");
    expect(settingsStatus("xero", { ...none, xero: { connected: true } })?.label).toBe("Connected");
    expect(settingsStatus("xero", { ...none, xero: { connected: false } })?.label).toBe("Not set up");
    expect(settingsStatus("mira", { ...none, mira: { hasApiKey: true, writeAccessEnabled: false } })?.label).toBe("On · read-only");
    expect(settingsStatus("mira", { ...none, mira: { hasApiKey: true, writeAccessEnabled: true } })?.label).toBe("On · can write");
    expect(settingsStatus("mira", { ...none, mira: { hasApiKey: false, writeAccessEnabled: false } })?.label).toBe("Not set up");
  });
});
