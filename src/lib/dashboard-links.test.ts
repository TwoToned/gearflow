import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DASHBOARD_LINKS, blockerLink, canOpenLink } from "@/lib/dashboard-links";
import { parseListState } from "@/lib/list-url-state";
import { JOBS_SPEC, jobsQueryArgs } from "@/lib/list-views/jobs";
import { ASSETS_SPEC } from "@/lib/list-views/assets";

const APP = join(process.cwd(), "src/app/(app)");

function split(href: string): { path: string; params: URLSearchParams } {
  const [path, query = ""] = href.split("?");
  return { path, params: new URLSearchParams(query) };
}

describe("DASHBOARD_LINKS", () => {
  it("every href opens a real (app) route", () => {
    for (const [key, link] of Object.entries(DASHBOARD_LINKS)) {
      const { path } = split(link.href);
      expect(existsSync(join(APP, path, "page.tsx")), `${key} → ${path}`).toBe(true);
    }
  });

  it("every Jobs href survives the Jobs URL parser intact (nothing dropped as junk)", () => {
    const jobs = Object.values(DASHBOARD_LINKS).filter((l) => split(l.href).path === "/projects");
    expect(jobs.length).toBeGreaterThan(0);
    for (const link of jobs) {
      const { params } = split(link.href);
      const state = parseListState(params, JOBS_SPEC);
      const seg = params.get("seg");
      if (seg) expect(state.seg, link.href).toBe(seg);
      for (const key of [...params.keys()].filter((k) => k !== "seg")) {
        expect(state.filters[key], `${link.href} keeps ${key}`).toEqual([params.get(key)]);
      }
    }
  });

  it("the Overdue returns tile opens the overdue filter on segment All (D85, Q1)", () => {
    const { params } = split(DASHBOARD_LINKS.overdueReturns.href);
    const state = parseListState(params, JOBS_SPEC);
    expect(state.seg).toBe("all");
    expect(jobsQueryArgs(state, 0).overdue).toBe(true);
  });

  it("the Active jobs tile opens the Active segment (D86)", () => {
    const state = parseListState(split(DASHBOARD_LINKS.activeJobs.href).params, JOBS_SPEC);
    expect(state.seg).toBe("active");
  });

  it("the Gear deployed tile's status filter survives the Assets URL parser", () => {
    const { params } = split(DASHBOARD_LINKS.gearDeployed.href);
    expect(parseListState(params, ASSETS_SPEC).filters.status).toEqual(["CHECKED_OUT"]);
  });

  it("a blocker opens its job", () => {
    expect(blockerLink("p1").href).toBe("/projects/p1");
  });
});

describe("canOpenLink", () => {
  it("needs read on the link's resource; loading permissions read as no", () => {
    expect(canOpenLink(DASHBOARD_LINKS.activity, { reports: ["read"] })).toBe(true);
    expect(canOpenLink(DASHBOARD_LINKS.activity, { project: ["read"] })).toBe(false);
    expect(canOpenLink(DASHBOARD_LINKS.activity, null)).toBe(false);
    expect(canOpenLink({ href: "/x", tip: "x" }, null)).toBe(true);
  });
});
