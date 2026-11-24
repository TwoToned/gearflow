import { describe, expect, it } from "vitest";
import {
  actionRows,
  appendDistinct,
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
import { parseListState } from "@/lib/list-url-state";
import { JOBS_SPEC } from "@/lib/list-views/jobs";
import { ASSETS_SPEC } from "@/lib/list-views/assets";

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

  it("a group without a list expands in place instead, counting exactly the rows it will show", () => {
    const many = Array.from({ length: 6 }, (_, i) => res("client", `c${i}`, `Client ${i}`));
    // The server matched 40, but only 6 came back: expanding shows 6, so it says 6.
    const s = searchSections(many, [{ type: "client", total: 40, truncated: true }], "cli", new Set());
    const more = s[0].rows[4];
    expect(more.title).toBe("Show all 6 in Clients ›");
    expect(more.action).toEqual({ kind: "expand", family: "clients" });
    expect(searchSections(many, [], "cli", new Set(["clients"]))[0].rows).toHaveLength(6);
  });

  it("each list link counts ONE type, the one its list holds: assets, bulk stock, jobs incl. cancelled; kits expand", () => {
    const mixed = [
      ...Array.from({ length: 5 }, (_, i) => res("asset", `a${i}`, `AURA-0${i}`)),
      ...Array.from({ length: 5 }, (_, i) => res("bulk-asset", `b${i}`, `XLR-${i}`)),
      ...Array.from({ length: 5 }, (_, i) => res("kit", `k${i}`, `KIT-${i} — Rig`)),
      ...Array.from({ length: 5 }, (_, i) => res("project", `p${i}`, `23${i}0 — Gig`)),
    ];
    const groups = [
      { type: "asset" as const, total: 9, truncated: false },
      { type: "bulk-asset" as const, total: 6, truncated: false },
      { type: "kit" as const, total: 12, truncated: false },
      { type: "project" as const, total: 8, truncated: false },
    ];
    const by = Object.fromEntries(searchSections(mixed, groups, "x y", new Set()).map((s) => [s.label, s.rows.at(-1)!]));
    expect(by["Assets"]).toMatchObject({ title: "Show all 9 in Assets ›", href: "/assets/registry?q=x%20y" });
    expect(by["Bulk stock"]).toMatchObject({ title: "Show all 6 in Bulk stock ›", href: "/assets/registry?kind=bulk&q=x%20y" });
    expect(by["Jobs"]).toMatchObject({ title: "Show all 8 in Jobs ›", href: "/projects?show=cancelled&q=x%20y" });
    expect(by["Kits"]).toMatchObject({ title: "Show all 5 in Kits ›", action: { kind: "expand", family: "kits" } });
  });

  it("every list link survives its list's own URL parser (nothing dropped as junk)", () => {
    const one = (type: SearchResult["type"]) => Array.from({ length: 5 }, (_, i) => res(type, `${type}${i}`, `${type} ${i}`));
    const s = searchSections([...one("asset"), ...one("bulk-asset"), ...one("project")], [], "q", new Set());
    const hrefs = s.map((x) => x.rows.at(-1)!.href!);
    const parse = (href: string, spec: typeof JOBS_SPEC) => parseListState(new URLSearchParams(href.split("?")[1]), spec);
    expect(parse(hrefs[0], ASSETS_SPEC)).toMatchObject({ q: "q" });
    expect(parse(hrefs[1], ASSETS_SPEC).filters.kind).toEqual(["bulk"]);
    expect(parse(hrefs[2], JOBS_SPEC).filters.show).toEqual(["cancelled"]);
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

  it("appendDistinct: a job on the day that the search also found shows ONCE, in the day's group", () => {
    const day = dateSections(d, { rows: [{ id: "p1", projectNumber: "2341", name: "Hilton gala", status: "CONFIRMED" }], total: 1 }, []);
    const found = searchSections(
      [res("project", "p1", "2341 — Hilton gala"), res("project", "p2", "2342 — Qantas"), res("model", "m1", "Hilton lectern")],
      [{ type: "project", total: 2, truncated: false }, { type: "model", total: 1, truncated: false }],
      "14/11 hilton",
      new Set(),
    );
    const all = appendDistinct(day, found);
    const ids = flattenSections(all, true).map((r) => r.id);
    expect(ids.filter((id) => id === "project-p1")).toHaveLength(1);
    expect(ids).toContain("project-p2");
    expect(ids).toContain("model-m1");
    expect(labels(all)[0]).toBe("Jobs on 14 Nov · 1");
  });

  it("appendDistinct drops a section the dedupe empties", () => {
    const day = dateSections(d, { rows: [{ id: "p1", projectNumber: "2341", name: "Hilton gala", status: "CONFIRMED" }], total: 1 }, []);
    const found = searchSections([res("project", "p1", "2341 — Hilton gala")], [{ type: "project", total: 1, truncated: false }], "14/11", new Set());
    expect(labels(appendDistinct(day, found))).toEqual(["Jobs on 14 Nov · 1", "Schedule"]);
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
