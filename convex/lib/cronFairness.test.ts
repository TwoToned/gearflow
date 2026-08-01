// @vitest-environment node
//
// convex/lib/cronFairness.ts — the per-org fairness post-filter for bounded
// platform-wide cron scans (#1077, A7). The property under test: a
// high-volume org can never consume the entire shared budget and starve
// every other org out of a tick.
import { describe, test, expect } from "vitest";
import { applyPerOrgFairnessCap } from "./cronFairness";

function row(organizationId: string, n: number) {
  return { organizationId, n };
}

describe("applyPerOrgFairnessCap", () => {
  test("passes everything through when no org exceeds the cap", () => {
    const rows = [row("org_a", 1), row("org_b", 1), row("org_a", 2)];
    const result = applyPerOrgFairnessCap(rows, 5);
    expect(result.rows).toHaveLength(3);
    expect(result.cappedOrgIds.size).toBe(0);
  });

  test("caps a high-volume org's rows while a low-volume org is untouched — the starvation fix", () => {
    const heavy = Array.from({ length: 10 }, (_, i) => row("org_heavy", i));
    const light = [row("org_light", 0)];
    // org_heavy sorts first, mirroring the real bug: a naive single-cap read
    // whose prefix is dominated by one org would never reach org_light at all.
    const rows = [...heavy, ...light];

    const result = applyPerOrgFairnessCap(rows, 3);

    const keptByOrg = new Map<string, number>();
    for (const r of result.rows) keptByOrg.set(r.organizationId, (keptByOrg.get(r.organizationId) ?? 0) + 1);

    expect(keptByOrg.get("org_heavy")).toBe(3);
    // The load-bearing assertion: org_light's row survives the cap even
    // though it appears after org_heavy has already exhausted its share.
    expect(keptByOrg.get("org_light")).toBe(1);
    expect(result.cappedOrgIds.has("org_heavy")).toBe(true);
    expect(result.cappedOrgIds.has("org_light")).toBe(false);
  });

  test("an empty input returns an empty result with no capped orgs", () => {
    const result = applyPerOrgFairnessCap([], 5);
    expect(result.rows).toEqual([]);
    expect(result.cappedOrgIds.size).toBe(0);
  });

  test("a cap of 0 drops every row and marks every org present as capped", () => {
    const rows = [row("org_a", 1), row("org_b", 1)];
    const result = applyPerOrgFairnessCap(rows, 0);
    expect(result.rows).toEqual([]);
    expect(result.cappedOrgIds).toEqual(new Set(["org_a", "org_b"]));
  });
});
