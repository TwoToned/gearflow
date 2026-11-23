import { describe, expect, it } from "vitest";
import {
  actionRows,
  dateSections,
  emptySections,
  flattenSections,
  noMatchCopy,
  onPageLabel,
  onPageRows,
  searchSections,
  type PaletteRow,
} from "@/lib/palette/model";
import { parsePaletteDate } from "@/lib/palette/date-query";
import { matchSlashCommands } from "@/lib/slash-commands";
import { rolePermissions } from "@/lib/permissions";
import type { SearchResult } from "@/lib/search-types";

const res = (type: SearchResult["type"], id: string, title: string, extra: Partial<SearchResult> = {}): SearchResult => ({
  id, type, title, subtitle: null, href: `/${type}/${id}`, relevance: 1, ...extra,
});

const labels = (sections: { label: string | null }[]) => sections.map((s) => s.label);
const titles = (rows: PaletteRow[]) => rows.map((r) => `${r.mono ? `${r.mono} ` : ""}${r.title}`.trim());

describe("searchSections (§6d.3: grouped, best group first, four rows each)", () => {
  const results = [
    res("model", "m1", "Aura PXL"),
    res("asset", "a1", "AURA-01", { isChild: true }),
    ...Array.from({ length: 6 }, (_, i) => res("asset", `x${i}`, `AURA-1${i} — Spare`)),
    res("project", "p1", "2341 — Hilton gala", { status: "CONFIRMED" }),
    res("client", "c1", "Hilton Sydney"),
  ];
  const groups = [
    { type: "model" as const, total: 1, truncated: false },
    { type: "asset" as const, total: 7, truncated: false },
    { type: "project" as const, total: 1, truncated: false },
    { type: "client" as const, total: 1, truncated: false },
  ];

  it("groups in the order their best row ranked, with the §6d.3 names", () => {
    expect(labels(searchSections(results, groups, "aura", new Set()))).toEqual(["Models", "Assets", "Jobs", "Clients"]);
  });

  it("four rows per group, then `Show all n in Assets ›` opening the Assets list on the query", () => {
    const assets = searchSections(results, groups, "aura", new Set()).find((s) => s.label === "Assets")!;
    expect(assets.rows).toHaveLength(5);
    const more = assets.rows[4];
    expect(more.title).toBe("Show all 7 in Assets ›");
    expect(more.href).toBe("/assets/registry?q=aura");
  });

  it("a group without a list expands in place instead, and only when it hides rows", () => {
    const many = Array.from({ length: 6 }, (_, i) => res("client", `c${i}`, `Client ${i}`));
    const s = searchSections(many, [{ type: "client", total: 6, truncated: true }], "cli", new Set());
    const more = s[0].rows[4];
    expect(more.title).toBe("Show all 6+ in Clients ›");
    expect(more.action).toEqual({ kind: "expand", family: "clients" });
    expect(searchSections(many, [], "cli", new Set(["clients"]))[0].rows).toHaveLength(6);
  });

  it("a job row is mono number + name, with its status for the dot-word, and records into Recent", () => {
    const jobs = searchSections(results, groups, "aura", new Set()).find((s) => s.label === "Jobs")!;
    expect(jobs.rows[0]).toMatchObject({ mono: "2341", title: "Hilton gala", status: "CONFIRMED", recent: { type: "project", id: "p1" } });
  });

  it("children ride with their parent and only count as rows while shown", () => {
    const s = searchSections(results, groups, "aura", new Set());
    expect(s[0].rows[0].children?.map((c) => c.mono)).toEqual(["AURA-01"]);
    expect(flattenSections(s, true).length).toBe(flattenSections(s, false).length + 1);
  });
});

describe("emptySections (§6d.3: Recent, On #…, Actions)", () => {
  const recent = [{ id: "project-p1", title: "Hilton gala", mono: "2341", subtitle: null, icon: "type:project", href: "/projects/p1" }];

  it("Recent (at most five), then the page's own group, then Actions; empty groups are absent", () => {
    const s = emptySections({
      recent: Array.from({ length: 7 }, () => recent[0]),
      onPage: { label: "On #2341 Hilton gala", rows: [{ id: "slash-x", title: "Quote", subtitle: null, icon: "FileText" }] },
      actions: [],
    });
    expect(labels(s)).toEqual(["Recent", "On #2341 Hilton gala"]);
    expect(s[0].rows).toHaveLength(5);
  });

  it("Actions are gated: New job · Scan · New asset · New client for an admin; none of them for a viewer", () => {
    const admin = matchSlashCommands("", "/dashboard", rolePermissions.admin).filter((m) => !m.isPageSpecific);
    expect(titles(actionRows(admin, true))).toEqual(["New job", "Scan a tag", "New asset", "New client"]);
    const viewer = matchSlashCommands("", "/dashboard", rolePermissions.viewer).filter((m) => !m.isPageSpecific);
    expect(actionRows(viewer, false)).toEqual([]);
  });

  it("`On …` names the record the page shows, only on a record page", () => {
    const trail = [{ label: "Jobs", href: "/projects" }, { label: "#2341 Hilton gala" }];
    const id = "cm1abcdefghijklmnopqrstuv";
    expect(onPageLabel(`/projects/${id}`, trail, id)).toBe("On #2341 Hilton gala");
    expect(onPageLabel("/dashboard", [{ label: "Home" }], null)).toBeNull();
    expect(onPageLabel(`/settings/${id}`, trail, id)).toBeNull();
    const rows = onPageRows(matchSlashCommands("", `/projects/${id}`, rolePermissions.admin));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.action?.kind === "slash")).toBe(true);
  });
});

describe("dateSections (`14/11`, `14 nov`)", () => {
  const d = parsePaletteDate("14/11", new Date(2026, 10, 22).getTime())!;

  it("that day's jobs (count in the label), then the Schedule for the day", () => {
    const s = dateSections(d, { rows: [{ id: "p1", projectNumber: "2341", name: "Hilton gala", status: "CONFIRMED" }], total: 7 }, []);
    expect(s[0].label).toMatch(/^Jobs on 14 Nov · 7$/);
    expect(s[0].rows[0]).toMatchObject({ mono: "2341", href: "/projects/p1" });
    expect(s.at(-1)!.rows[0]).toMatchObject({ href: "/availability?date=2026-11-14" });
  });

  it("no jobs that day (or still loading): just the Schedule", () => {
    expect(labels(dateSections(d, { rows: [], total: 0 }, []))).toEqual(["Schedule"]);
    expect(labels(dateSections(d, undefined, []))).toEqual(["Schedule"]);
  });
});

describe("noMatchCopy", () => {
  it("says what didn't match and what to try next", () => {
    expect(noMatchCopy(" zzz ")).toEqual({
      title: "Nothing matches “zzz”",
      hint: "Try a job number, an asset tag or a client name · @ pages · / actions",
    });
  });
});
