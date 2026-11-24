import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_NAV, NAV, NOT_IN_NAV, SETTINGS_PREFIX, bottomNavActive, findNavItem, findNavSub, visibleNav,
} from "@/lib/nav";

/** Every static (no dynamic segment) `page.tsx` route under src/app/(app). */
function staticAppRoutes(): string[] {
  const root = join(process.cwd(), "src/app/(app)");
  const out: string[] = [];
  const walk = (dir: string, route: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (!name.includes("[")) walk(full, `${route}/${name}`);
      } else if (name === "page.tsx") {
        out.push(route || "/");
      }
    }
  };
  walk(root, "");
  return out;
}

const navUrls = new Set(ALL_NAV.flatMap((i) => [i.url, ...(i.subs ?? []).map((s) => s.url)]));

describe("NAV drift", () => {
  it("every static app route is in NAV, the settings family, or the explicit NOT_IN_NAV list", () => {
    const orphans = staticAppRoutes().filter(
      (r) => !navUrls.has(r) && !NOT_IN_NAV[r] && r !== SETTINGS_PREFIX && !r.startsWith(SETTINGS_PREFIX + "/"),
    );
    expect(orphans).toEqual([]);
  });

  it("NOT_IN_NAV lists only routes that exist (no stale entries)", () => {
    const routes = new Set(staticAppRoutes());
    expect(Object.keys(NOT_IN_NAV).filter((r) => !routes.has(r))).toEqual([]);
  });

  it("keys are unique and the sidebar has exactly three groups in the §6d.2 order", () => {
    const keys = ALL_NAV.flatMap((i) => [i.key, ...(i.subs ?? []).map((s) => s.key)]);
    expect(new Set(keys).size).toBe(keys.length);
    const labels = (g: number) => NAV.filter((i) => i.group === g).map((i) => i.label);
    expect(labels(0)).toEqual(["Home", "Jobs", "Finance", "Schedule"]);
    expect(labels(1)).toEqual(["Crew", "Assets", "Warehouse", "Test & Tag", "Maintenance"]);
    expect(labels(2)).toEqual(["Clients", "Suppliers", "Locations", "Activity"]);
  });

  it("does not carry My tasks", () => {
    expect(navUrls.has("/my-tasks")).toBe(false);
  });

  it("Crew has ONE sub (Planner); Timesheets and the old roles route are deliberate deep links (D48)", () => {
    const crew = NAV.find((i) => i.key === "crew")!;
    expect(crew.subs!.map((s) => s.url)).toEqual(["/crew/planner"]);
    // The ONE Crew row carries Phase 11's reserved `crew` count source.
    expect(crew.count).toBe("crew");
    expect(navUrls.has("/crew/timesheets")).toBe(false);
    expect(NOT_IN_NAV["/crew/timesheets"]).toBeTruthy();
    expect(NOT_IN_NAV["/crew/settings"]).toMatch(/sheet=roles/);
    // Still the Crew module, lit in the shell and named in the trail.
    expect(findNavItem("/crew/timesheets")?.key).toBe("crew");
  });
});

describe("visibleNav gating", () => {
  it("is permissive while permissions load (null)", () => {
    expect(visibleNav(null).map((i) => i.key)).toContain("warehouse");
  });

  it("removes gated rows and sub-rows entirely", () => {
    const keys = visibleNav({ project: ["read"], client: ["read"] }).map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(["home", "jobs", "clients"]));
    expect(keys).not.toContain("warehouse");
    expect(keys).not.toContain("settings");
    const jobs = visibleNav({ project: ["read"] }).find((i) => i.key === "jobs")!;
    expect(jobs.subs!.length).toBe(2);
  });

  it("Settings shows for orgMembers alone (any-of)", () => {
    expect(visibleNav({ orgMembers: ["read"] }).map((i) => i.key)).toContain("settings");
  });

  it("drops a sub-row whose own resource is denied", () => {
    const assets = visibleNav({ asset: ["read"] }).find((i) => i.key === "assets")!;
    expect(assets.subs).toEqual([]);
  });
});

describe("route lookups", () => {
  it("finds the module and sub-row for a pathname", () => {
    expect(findNavItem("/projects/abc123")?.key).toBe("jobs");
    expect(findNavItem("/kits/x")?.key).toBe("assets");
    expect(findNavSub("/assets/models")?.sub.key).toBe("asset-models");
    expect(findNavItem("/nowhere")).toBeNull();
  });

  it("bottom bar: route tabs, then More for Crew/Assets/Settings/account, else none", () => {
    expect(bottomNavActive("/dashboard")).toBe("home");
    expect(bottomNavActive("/projects/x")).toBe("jobs");
    expect(bottomNavActive("/warehouse/returns")).toBe("warehouse");
    expect(bottomNavActive("/crew")).toBe("more");
    expect(bottomNavActive("/assets/registry")).toBe("more");
    expect(bottomNavActive("/settings/team")).toBe("more");
    expect(bottomNavActive("/account")).toBe("more");
    expect(bottomNavActive("/notifications")).toBeNull();
  });
});
