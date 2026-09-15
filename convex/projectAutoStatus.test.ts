// @vitest-environment node
//
// Project status automation (#1160). Covers the three properties the module's
// docstring claims — forward-only from an explicit set, never into a
// snapshotting/hard-locking tier, org opt-out honoured — plus the two "all"
// conditions and the audit row, driven against a real seeded DB.
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import {
  AUTO_STATUS_RULES,
  AUTO_STATUS_TRIGGERS,
  maybeAutoAdvanceProjectStatus,
  type AutoStatusTrigger,
} from "./lib/projectAutoStatus";
import { lockTierForStatus } from "./lib/projectLocks";
import { AUTO_STATUS_KEYS } from "@/lib/project-status-automation";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_other";
const PROJ = "proj_1";
const NOW = 1_700_000_000_000;
const ACTOR = { userId: "user_1", userName: "Ash" };

function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  registerShardedCounter(t, "shardedCounter");
  return t;
}
type T = ReturnType<typeof makeT>;

async function seedProject(t: T, status: string, opts: { orgId?: string; isTemplate?: boolean } = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: PROJ,
      organizationId: opts.orgId ?? ORG,
      projectNumber: "P-001",
      name: "Gig",
      status: status as never,
      total: 0,
      ...(opts.isTemplate ? { isTemplate: true } : {}),
    });
  });
}

/** One line item, shaped by the two fields every rule actually reads. */
async function seedLine(t: T, id: string, status: string, prepStatus?: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projectLineItems", {
      id,
      organizationId: ORG,
      projectId: PROJ,
      quantity: 1,
      status: status as never,
      ...(prepStatus ? { prepStatus: prepStatus as never } : {}),
    });
  });
}

async function optOut(t: T, key: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgSettings", {
      organizationId: ORG,
      settings: JSON.stringify({ projectStatusAutomation: { [key]: false } }),
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

function advance(t: T, trigger: AutoStatusTrigger, orgId = ORG) {
  return t.run((ctx) =>
    maybeAutoAdvanceProjectStatus(ctx, { orgId, projectId: PROJ, trigger, actor: ACTOR, now: NOW }),
  );
}

const projectStatus = (t: T) =>
  t.run(async (ctx) => (await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", PROJ)).first())?.status);

// ─── The rule table's own invariants (no DB needed) ─────────────────────────

describe("AUTO_STATUS_RULES — table invariants", () => {
  test("the settings keys mirror src/lib/project-status-automation.ts exactly", () => {
    // The convex/src boundary has no shared module, so this IS the R-3.1 guard:
    // adding a trigger on one side without the other fails here.
    const fromRules = AUTO_STATUS_TRIGGERS.map((t) => AUTO_STATUS_RULES[t].settingKey).sort();
    expect(fromRules).toEqual([...AUTO_STATUS_KEYS].sort());
  });

  test("no rule is allowed to advance INTO a snapshotting or hard-locked status", () => {
    // Entering CONFIRMED snapshots + gates on an accepted quote; COMPLETED/INVOICED
    // hard-lock the project. Both stay a deliberate human click.
    for (const trigger of AUTO_STATUS_TRIGGERS) {
      expect(["CONFIRMED", "COMPLETED", "INVOICED"]).not.toContain(AUTO_STATUS_RULES[trigger].to);
    }
  });

  test("no rule may fire from a terminal or already-past status", () => {
    for (const trigger of AUTO_STATUS_TRIGGERS) {
      const rule = AUTO_STATUS_RULES[trigger];
      expect(rule.from).not.toContain("CANCELLED");
      expect(rule.from).not.toContain("COMPLETED");
      expect(rule.from).not.toContain("INVOICED");
      // A rule can never target a status it also allows as a source — that would
      // be a self-transition, and would make "did this move?" unanswerable.
      expect(rule.from).not.toContain(rule.to);
    }
  });

  test("every move is forward, and never LOWERS the lock tier", () => {
    const RANK = ["ENQUIRY", "QUOTING", "QUOTED", "CONFIRMED", "PREPPING", "CHECKED_OUT", "ON_SITE", "RETURNED"];
    const TIERS = ["OPEN", "FINANCE_LOCKED", "JUSTIFY", "HARD_LOCKED"];
    for (const trigger of AUTO_STATUS_TRIGGERS) {
      const rule = AUTO_STATUS_RULES[trigger];
      for (const from of rule.from) {
        expect(RANK.indexOf(rule.to)).toBeGreaterThan(RANK.indexOf(from));
        expect(TIERS.indexOf(lockTierForStatus(rule.to))).toBeGreaterThanOrEqual(
          TIERS.indexOf(lockTierForStatus(from)),
        );
      }
    }
  });
});

// ─── QUOTE_SENT ────────────────────────────────────────────────────────────

describe("QUOTE_SENT", () => {
  test("ENQUIRY advances to QUOTED", async () => {
    const t = makeT();
    await seedProject(t, "ENQUIRY");
    expect(await advance(t, "QUOTE_SENT")).toBe("QUOTED");
    expect(await projectStatus(t)).toBe("QUOTED");
  });

  test("is idempotent — a resend from QUOTED is a no-op", async () => {
    const t = makeT();
    await seedProject(t, "QUOTED");
    expect(await advance(t, "QUOTE_SENT")).toBeNull();
  });

  test("never drags a CONFIRMED job backwards", async () => {
    const t = makeT();
    await seedProject(t, "CONFIRMED");
    expect(await advance(t, "QUOTE_SENT")).toBeNull();
    expect(await projectStatus(t)).toBe("CONFIRMED");
  });

  test("leaves a CANCELLED job alone", async () => {
    const t = makeT();
    await seedProject(t, "CANCELLED");
    expect(await advance(t, "QUOTE_SENT")).toBeNull();
  });

  test("templates have no status to advance", async () => {
    const t = makeT();
    await seedProject(t, "ENQUIRY", { isTemplate: true });
    expect(await advance(t, "QUOTE_SENT")).toBeNull();
  });

  test("a caller from another org can't move this project (by_cuid is global)", async () => {
    const t = makeT();
    await seedProject(t, "ENQUIRY");
    expect(await advance(t, "QUOTE_SENT", OTHER)).toBeNull();
    expect(await projectStatus(t)).toBe("ENQUIRY");
  });

  test("respects the org opt-out", async () => {
    const t = makeT();
    await seedProject(t, "ENQUIRY");
    await optOut(t, "quoteSent");
    expect(await advance(t, "QUOTE_SENT")).toBeNull();
    expect(await projectStatus(t)).toBe("ENQUIRY");
  });

  test("an opt-out on a DIFFERENT rule doesn't disable this one", async () => {
    const t = makeT();
    await seedProject(t, "ENQUIRY");
    await optOut(t, "allReturned");
    expect(await advance(t, "QUOTE_SENT")).toBe("QUOTED");
  });

  test("writes an auditable STATUS_CHANGE row naming the trigger", async () => {
    const t = makeT();
    await seedProject(t, "ENQUIRY");
    await advance(t, "QUOTE_SENT");
    const log = await t.run(async (ctx) =>
      (await ctx.db.query("activityLogs").collect()).find((r) => r.action === "STATUS_CHANGE"),
    );
    expect(log?.metadata).toMatchObject({ autoAdvanceTrigger: "QUOTE_SENT", statusFrom: "ENQUIRY", statusTo: "QUOTED" });
    expect(log?.userName).toBe("Ash");
    expect(log?.summary).toContain("Auto-advanced to QUOTED");
  });
});

// ─── PREP_STARTED ──────────────────────────────────────────────────────────

describe("PREP_STARTED", () => {
  test("CONFIRMED advances to PREPPING", async () => {
    const t = makeT();
    await seedProject(t, "CONFIRMED");
    expect(await advance(t, "PREP_STARTED")).toBe("PREPPING");
  });

  test("the second item prepped is a no-op", async () => {
    const t = makeT();
    await seedProject(t, "CONFIRMED");
    await advance(t, "PREP_STARTED");
    expect(await advance(t, "PREP_STARTED")).toBeNull();
  });

  test("a re-prep during a partial return doesn't drag the job back from ON_SITE", async () => {
    const t = makeT();
    await seedProject(t, "ON_SITE");
    expect(await advance(t, "PREP_STARTED")).toBeNull();
    expect(await projectStatus(t)).toBe("ON_SITE");
  });
});

// ─── ALL_CHECKED_OUT ───────────────────────────────────────────────────────

describe("ALL_CHECKED_OUT", () => {
  test("advances once nothing is left packed on the dock", async () => {
    const t = makeT();
    await seedProject(t, "PREPPING");
    await seedLine(t, "li1", "CHECKED_OUT", "PACKED");
    expect(await advance(t, "ALL_CHECKED_OUT")).toBe("CHECKED_OUT");
  });

  test("a partial deploy leaves the job at PREPPING", async () => {
    const t = makeT();
    await seedProject(t, "PREPPING");
    await seedLine(t, "li1", "CHECKED_OUT", "PACKED");
    await seedLine(t, "li2", "PREPPED", "PACKED"); // still waiting
    expect(await advance(t, "ALL_CHECKED_OUT")).toBeNull();
    expect(await projectStatus(t)).toBe("PREPPING");
  });

  test("also sees a waiting line that stayed CONFIRMED (direct kit-prep shape)", async () => {
    const t = makeT();
    await seedProject(t, "PREPPING");
    await seedLine(t, "li1", "CHECKED_OUT", "PACKED");
    await seedLine(t, "li2", "CONFIRMED", "PACKED");
    expect(await advance(t, "ALL_CHECKED_OUT")).toBeNull();
  });

  test("non-gear lines never hold the job back — a service line is never PACKED", async () => {
    const t = makeT();
    await seedProject(t, "PREPPING");
    await seedLine(t, "li1", "CHECKED_OUT", "PACKED");
    await seedLine(t, "svc", "CONFIRMED"); // no prepStatus — a service/labour/sale line
    expect(await advance(t, "ALL_CHECKED_OUT")).toBe("CHECKED_OUT");
  });

  test("a job where nothing ever went out does not 'finish' deploying", async () => {
    const t = makeT();
    await seedProject(t, "PREPPING");
    await seedLine(t, "svc", "CONFIRMED");
    expect(await advance(t, "ALL_CHECKED_OUT")).toBeNull();
  });
});

// ─── ALL_RETURNED ──────────────────────────────────────────────────────────

describe("ALL_RETURNED", () => {
  test("advances when the last outstanding line comes back", async () => {
    const t = makeT();
    await seedProject(t, "CHECKED_OUT");
    await seedLine(t, "li1", "RETURNED", "PACKED");
    expect(await advance(t, "ALL_RETURNED")).toBe("RETURNED");
  });

  test("one line still out blocks it", async () => {
    const t = makeT();
    await seedProject(t, "ON_SITE");
    await seedLine(t, "li1", "RETURNED");
    await seedLine(t, "li2", "CHECKED_OUT");
    expect(await advance(t, "ALL_RETURNED")).toBeNull();
    expect(await projectStatus(t)).toBe("ON_SITE");
  });

  test("auto-commits an unlock session rather than letting it span the change", async () => {
    const t = makeT();
    await seedProject(t, "CHECKED_OUT");
    await seedLine(t, "li1", "RETURNED");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectUnlockSessions", {
        id: "sess_1",
        organizationId: ORG,
        projectId: PROJ,
        scope: "FINANCIAL",
        justification: "fixing a rate",
        snapshotId: "snap_1",
        openedBy: ACTOR.userId,
        openedAt: NOW - 1000,
        outcome: "OPEN",
      });
    });
    expect(await advance(t, "ALL_RETURNED")).toBe("RETURNED");
    const session = await t.run(async (ctx) =>
      await ctx.db.query("projectUnlockSessions").withIndex("by_cuid", (q) => q.eq("id", "sess_1")).first(),
    );
    expect(session?.outcome).toBe("COMMITTED");
  });
});
