// @vitest-environment node
import { describe, test, expect } from "vitest";
import {
  buildReadinessChecks,
  summariseReadiness,
  type BuildChecksInput,
  type ReadinessCheckId,
} from "@/lib/project-readiness-checks";

function input(over: Partial<BuildChecksInput> = {}): BuildChecksInput {
  return {
    hasWindow: true,
    windowLabel: "12 – 16 Aug",
    gear: { hard: [], pencilled: [] },
    crew: { unconfirmedCount: 0, activeCount: 0, servicesMissingCrew: [], crewShortfall: 0, unconfirmedServices: [], activeServiceCount: 0 },
    pricing: { unpriced: [], unpricedCount: 0 },
    conflicts: [],
    ...over,
  };
}

const byId = (checks: ReturnType<typeof buildReadinessChecks>, id: ReadinessCheckId) =>
  checks.find((c) => c.id === id)!;

describe("gear check", () => {
  test("a hard shortage blocks and names the models", () => {
    const c = byId(
      buildReadinessChecks(input({ gear: { hard: [{ modelName: "Shure ULXD4Q", qty: 2 }], pencilled: [] } })),
      "gear",
    );
    expect(c.severity).toBe("blocking");
    expect(c.detail).toContain("Shure ULXD4Q ×2");
    expect(c.detail).toContain("12 – 16 Aug");
  });

  test("pencilled demand warns in the conditional, never the indicative", () => {
    const c = byId(
      buildReadinessChecks(input({ gear: { hard: [], pencilled: [{ modelName: "Maverick", qty: 1 }] } })),
      "gear",
    );
    expect(c.severity).toBe("warning");
    expect(c.title).toBe("Gear would be short if you confirm");
  });

  test("a hard shortage outranks a pencilled one", () => {
    const c = byId(
      buildReadinessChecks(
        input({ gear: { hard: [{ modelName: "A", qty: 1 }], pencilled: [{ modelName: "B", qty: 5 }] } }),
      ),
      "gear",
    );
    expect(c.severity).toBe("blocking");
  });

  test("a dateless project reports unknown, never a clean pass", () => {
    const c = byId(buildReadinessChecks(input({ hasWindow: false, windowLabel: undefined })), "gear");
    expect(c.severity).toBe("unknown");
    expect(c.severity).not.toBe("pass");
  });

  test("long model lists are capped with an honest remainder", () => {
    const hard = [1, 2, 3, 4, 5].map((n) => ({ modelName: "M" + n, qty: n }));
    const c = byId(buildReadinessChecks(input({ gear: { hard, pencilled: [] } })), "gear");
    expect(c.detail).toContain("+2 more");
  });
});

describe("conflicts check", () => {
  const conflict = { assetTag: "MIX-004", modelName: "SQ-7", conflictingProject: { projectNumber: "P-2044" } };

  test("blocks and names the other project", () => {
    const c = byId(buildReadinessChecks(input({ conflicts: [conflict] })), "conflicts");
    expect(c.severity).toBe("blocking");
    expect(c.detail).toContain("P-2044");
    expect(c.title).toBe("1 asset double-booked");
  });

  test("passes when clean", () => {
    expect(byId(buildReadinessChecks(input()), "conflicts").severity).toBe("pass");
  });
});

describe("crew check", () => {
  test("warns on unconfirmed crew", () => {
    const c = byId(
      buildReadinessChecks(input({ crew: { unconfirmedCount: 3, activeCount: 11, servicesMissingCrew: [], crewShortfall: 0, unconfirmedServices: [], activeServiceCount: 0 } })),
      "crew",
    );
    expect(c.severity).toBe("warning");
    expect(c.title).toBe("3 of 11 crew unconfirmed");
  });

  test("an empty roster drops the row entirely — nothing to chase, nothing to show", () => {
    const checks = buildReadinessChecks(input());
    expect(checks.some((c) => c.id === "crew")).toBe(false);
  });

  test("a full confirmed roster says so", () => {
    const c = byId(
      buildReadinessChecks(input({ crew: { unconfirmedCount: 0, activeCount: 6, servicesMissingCrew: [], crewShortfall: 0, unconfirmedServices: [], activeServiceCount: 0 } })),
      "crew",
    );
    expect(c.title).toBe("All crew confirmed");
  });
});

describe("services check", () => {
  test("flags services still PLANNED as not confirmed", () => {
    const c = byId(
      buildReadinessChecks(
        input({
          crew: {
            unconfirmedCount: 0,
            activeCount: 0,
            servicesMissingCrew: [],
            crewShortfall: 0,
            unconfirmedServices: [{ title: "Bump-in" }, { title: "Bump-out" }],
            activeServiceCount: 3,
          },
        }),
      ),
      "services",
    );
    expect(c.severity).toBe("warning");
    expect(c.title).toBe("2 of 3 services not confirmed");
    expect(c.detail).toContain("Bump-in");
  });

  test("flags an understaffed service even when every service is confirmed", () => {
    const c = byId(
      buildReadinessChecks(
        input({
          crew: {
            unconfirmedCount: 0,
            activeCount: 2,
            servicesMissingCrew: [{ title: "Bump-in", shortfall: 2 }],
            crewShortfall: 2,
            unconfirmedServices: [],
            activeServiceCount: 1,
          },
        }),
      ),
      "services",
    );
    expect(c.severity).toBe("warning");
    expect(c.title).toBe("1 service short of crew");
    expect(c.detail).toContain("2 people");
  });

  test("reports both problems on one row when a service is unconfirmed AND short", () => {
    const c = byId(
      buildReadinessChecks(
        input({
          crew: {
            unconfirmedCount: 0,
            activeCount: 1,
            servicesMissingCrew: [{ title: "FOH", shortfall: 1 }],
            crewShortfall: 1,
            unconfirmedServices: [{ title: "FOH" }],
            activeServiceCount: 2,
          },
        }),
      ),
      "services",
    );
    expect(c.detail).toContain("not confirmed: FOH");
    expect(c.detail).toContain("short 1 person");
  });

  test("no services at all drops the row entirely — nothing scheduled, nothing to show", () => {
    const checks = buildReadinessChecks(input());
    expect(checks.some((c) => c.id === "services")).toBe(false);
  });

  test("confirmed and staffed says so", () => {
    const c = byId(
      buildReadinessChecks(
        input({
          crew: {
            unconfirmedCount: 0,
            activeCount: 4,
            servicesMissingCrew: [],
            crewShortfall: 0,
            unconfirmedServices: [],
            activeServiceCount: 2,
          },
        }),
      ),
      "services",
    );
    expect(c.severity).toBe("pass");
    expect(c.title).toBe("All services confirmed and staffed");
  });

  test("a CANCELLED service is settled-no — never flagged, never counted", () => {
    // The lib drops CANCELLED before this point, so `activeServiceCount` is
    // 0 and the row doesn't render at all — this pins the contract the lib
    // relies on.
    const checks = buildReadinessChecks(
      input({
        crew: {
          unconfirmedCount: 0,
          activeCount: 0,
          servicesMissingCrew: [],
          crewShortfall: 0,
          unconfirmedServices: [],
          activeServiceCount: 0,
        },
      }),
    );
    expect(checks.some((c) => c.id === "services")).toBe(false);
  });
});

describe("pricing check", () => {
  test("unpriced lines warn and are named", () => {
    const c = byId(
      buildReadinessChecks(input({ pricing: { unpriced: [{ label: "Truss bracket" }], unpricedCount: 1 } })),
      "pricing",
    );
    expect(c.severity).toBe("warning");
    expect(c.detail).toContain("Truss bracket");
  });

  test("passes on a clean project", () => {
    const checks = buildReadinessChecks(input());
    expect(byId(checks, "pricing").severity).toBe("pass");
  });
});

describe("ordering and summary", () => {
  test("order is stable regardless of severity so rows don't reshuffle", () => {
    // Default crew/services are both empty, so those two rows drop out —
    // only gear, conflicts and pricing survive on a clean, crewless project.
    const clean = buildReadinessChecks(input()).map((c) => c.id);
    const messy = buildReadinessChecks(
      input({ conflicts: [{ assetTag: "A", modelName: "M", conflictingProject: { projectNumber: "P-1" } }] }),
    ).map((c) => c.id);
    expect(clean).toEqual(["gear", "conflicts", "pricing"]);
    expect(messy).toEqual(clean);
  });

  test("services and crew rejoin the (still fixed) order once they're relevant", () => {
    const checks = buildReadinessChecks(
      input({
        crew: {
          unconfirmedCount: 0,
          activeCount: 4,
          servicesMissingCrew: [],
          crewShortfall: 0,
          unconfirmedServices: [],
          activeServiceCount: 2,
        },
      }),
    ).map((c) => c.id);
    expect(checks).toEqual(["gear", "conflicts", "services", "crew", "pricing"]);
  });

  test("all-clear only when every applicable check actually ran and passed", () => {
    expect(summariseReadiness(buildReadinessChecks(input())).allClear).toBe(true);
  });

  test("an unknown check never collapses into all-clear", () => {
    const s = summariseReadiness(buildReadinessChecks(input({ hasWindow: false })));
    expect(s.unknown).toBe(1);
    expect(s.allClear).toBe(false);
  });

  test("counts blocking and warning separately", () => {
    const s = summariseReadiness(
      buildReadinessChecks(
        input({
          gear: { hard: [{ modelName: "A", qty: 1 }], pencilled: [] },
          conflicts: [{ assetTag: "A", modelName: "M", conflictingProject: { projectNumber: "P-1" } }],
          pricing: { unpriced: [{ label: "Truss bracket" }], unpricedCount: 1 },
        }),
      ),
    );
    expect(s.blocking).toBe(2);
    expect(s.warning).toBe(1);
    expect(s.allClear).toBe(false);
  });
});
