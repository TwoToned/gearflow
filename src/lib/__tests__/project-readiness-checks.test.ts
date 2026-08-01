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
    crew: { unconfirmedCount: 0, activeCount: 0, servicesMissingCrew: [], crewShortfall: 0 },
    pricing: { unpriced: [], unpricedCount: 0 },
    conflicts: [],
    staleLineCount: 0,
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
      buildReadinessChecks(input({ crew: { unconfirmedCount: 3, activeCount: 11, servicesMissingCrew: [], crewShortfall: 0 } })),
      "crew",
    );
    expect(c.severity).toBe("warning");
    expect(c.title).toBe("3 of 11 crew unconfirmed");
  });

  test("warns on an understaffed service even when everyone assigned has confirmed", () => {
    const c = byId(
      buildReadinessChecks(
        input({
          crew: {
            unconfirmedCount: 0,
            activeCount: 2,
            servicesMissingCrew: [{ title: "Bump-in", shortfall: 2 }],
            crewShortfall: 2,
          },
        }),
      ),
      "crew",
    );
    expect(c.severity).toBe("warning");
    expect(c.title).toBe("1 service understaffed");
  });

  test("an empty roster passes without claiming everyone confirmed", () => {
    const c = byId(buildReadinessChecks(input()), "crew");
    expect(c.severity).toBe("pass");
    expect(c.title).toBe("No crew assigned yet");
  });

  test("a full confirmed roster says so", () => {
    const c = byId(
      buildReadinessChecks(input({ crew: { unconfirmedCount: 0, activeCount: 6, servicesMissingCrew: [], crewShortfall: 0 } })),
      "crew",
    );
    expect(c.title).toBe("All crew confirmed");
  });
});

describe("pricing and staleness checks", () => {
  test("unpriced lines warn and are named", () => {
    const c = byId(
      buildReadinessChecks(input({ pricing: { unpriced: [{ label: "Truss bracket" }], unpricedCount: 1 } })),
      "pricing",
    );
    expect(c.severity).toBe("warning");
    expect(c.detail).toContain("Truss bracket");
  });

  test("stale rates are a separate check with their own action", () => {
    const c = byId(buildReadinessChecks(input({ staleLineCount: 4 })), "staleness");
    expect(c.severity).toBe("warning");
    expect(c.actionLabel).toBe("Recalculate");
    expect(c.detail).toContain("4 line items need recalculating");
  });

  test("both pass on a clean project", () => {
    const checks = buildReadinessChecks(input());
    expect(byId(checks, "pricing").severity).toBe("pass");
    expect(byId(checks, "staleness").severity).toBe("pass");
  });
});

describe("ordering and summary", () => {
  test("order is stable regardless of severity so rows don't reshuffle", () => {
    const clean = buildReadinessChecks(input()).map((c) => c.id);
    const messy = buildReadinessChecks(
      input({ conflicts: [{ assetTag: "A", modelName: "M", conflictingProject: { projectNumber: "P-1" } }] }),
    ).map((c) => c.id);
    expect(clean).toEqual(["gear", "conflicts", "crew", "pricing", "staleness"]);
    expect(messy).toEqual(clean);
  });

  test("all-clear only when every check actually ran and passed", () => {
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
          staleLineCount: 2,
        }),
      ),
    );
    expect(s.blocking).toBe(2);
    expect(s.warning).toBe(1);
    expect(s.allClear).toBe(false);
  });
});
