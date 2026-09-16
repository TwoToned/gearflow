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
  PRICING_LOCK_ON_REACH,
  maybeAutoAdvanceProjectStatus,
  type AutoStatusTrigger,
} from "./lib/projectAutoStatus";
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

/** Every seeded project carries a live version ("v1") — Phase 2 (#1228) of
 *  "Project versioning v2" scopes the ALL_CHECKED_OUT/ALL_RETURNED reads onto
 *  it (`requireLiveVersionId`/`by_versionId*`, `convex/lib/projectAutoStatus.ts`),
 *  same as every other live-only read migrated in that phase. */
const LIVE_VERSION_ID = "v1";

async function seedProject(t: T, status: string, opts: { orgId?: string; isTemplate?: boolean } = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: PROJ,
      organizationId: opts.orgId ?? ORG,
      projectNumber: "P-001",
      name: "Gig",
      status: status as never,
      total: 0,
      liveVersionId: LIVE_VERSION_ID,
      ...(opts.isTemplate ? { isTemplate: true } : {}),
    });
    await ctx.db.insert("projectVersions", {
      id: LIVE_VERSION_ID,
      organizationId: opts.orgId ?? ORG,
      projectId: PROJ,
      number: 1,
      contentState: "ready",
      createdAt: NOW,
      createdById: ACTOR.userId,
    });
  });
}

/** One line item, shaped by the fields the deploy/return rules actually read.
 *  `type` defaults to EQUIPMENT — the same default `warehouseList` applies to a
 *  row that predates the column. Always stamped onto the seeded live version
 *  (`by_versionId`, not `by_projectId` — Phase 2 deleted the latter). */
async function seedLine(
  t: T,
  id: string,
  status: string,
  prepStatus?: string,
  extra: {
    type?: string;
    quantity?: number;
    checkedOutQuantity?: number;
    returnedQuantity?: number;
    isContainerLineItem?: boolean;
    subHireId?: string;
    parentLineItemId?: string;
  } = {},
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projectLineItems", {
      id,
      organizationId: ORG,
      projectId: PROJ,
      versionId: LIVE_VERSION_ID,
      lineageId: id,
      quantity: extra.quantity ?? 1,
      status: status as never,
      ...(extra.type ? { type: extra.type as never } : {}),
      ...(extra.checkedOutQuantity != null ? { checkedOutQuantity: extra.checkedOutQuantity } : {}),
      ...(extra.returnedQuantity != null ? { returnedQuantity: extra.returnedQuantity } : {}),
      ...(extra.isContainerLineItem ? { isContainerLineItem: true } : {}),
      ...(extra.subHireId ? { subHireId: extra.subHireId } : {}),
      ...(extra.parentLineItemId ? { parentLineItemId: extra.parentLineItemId, isKitChild: true } : {}),
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

  test("no rule advances INTO the hard-locked tier", () => {
    // Closing a job out is a human's call, and there is no event that means
    // "the work is finished". CONFIRMED is the one deliberate exception — see
    // the next test, which pins exactly which rule may reach it and why.
    for (const trigger of AUTO_STATUS_TRIGGERS) {
      expect(["COMPLETED", "INVOICED"]).not.toContain(AUTO_STATUS_RULES[trigger].to);
    }
  });

  test("PAYMENT_SETTLED is the ONLY rule that may reach CONFIRMED", () => {
    // #1236 relaxed "never automate into CONFIRMED" for exactly one rule,
    // because in this business payment IS the confirmation. It is safe only
    // because it re-checks the accepted-quote gate and takes the same snapshot
    // the manual path does (see `maybeAutoAdvanceProjectStatus`). A second rule
    // sneaking into CONFIRMED would not inherit either guarantee by accident —
    // so this test exists to make adding one a deliberate, visible act.
    const reaching = AUTO_STATUS_TRIGGERS.filter((t) => AUTO_STATUS_RULES[t].to === "CONFIRMED");
    expect(reaching).toEqual(["PAYMENT_SETTLED"]);
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

  test("every move is forward", () => {
    const RANK = [
      "ENQUIRY", "QUOTING", "QUOTED", "AWAITING_PAYMENT", "CONFIRMED",
      "PREPPING", "CHECKED_OUT", "ON_SITE", "RETURNED",
    ];
    for (const trigger of AUTO_STATUS_TRIGGERS) {
      const rule = AUTO_STATUS_RULES[trigger];
      for (const from of rule.from) {
        expect(RANK.indexOf(rule.to)).toBeGreaterThan(RANK.indexOf(from));
      }
    }
  });

  // #1230 × #1236 merge — every rule that can reach a PRICING_LOCK_ON_REACH
  // status from a status NOT already implying pricingLocked must be one this
  // module defensively locks for (see maybeAutoAdvanceProjectStatus's own
  // note) — pins the set so a future rule addition can't silently reopen the
  // gap this merge closed.
  test("PRICING_LOCK_ON_REACH is exactly {AWAITING_PAYMENT, CONFIRMED}", () => {
    expect([...PRICING_LOCK_ON_REACH].sort()).toEqual(["AWAITING_PAYMENT", "CONFIRMED"]);
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

// ─── The money phase (#1236) ───────────────────────────────────────────────

/** Seed an ACCEPTED revision so the PAYMENT_SETTLED gate can pass. */
async function seedAcceptedQuote(t: T, orgId = ORG) {
  await t.run(async (ctx) => {
    await ctx.db.insert("quotes", {
      id: "q1",
      organizationId: orgId,
      projectId: PROJ,
      version: 1,
      status: "ACCEPTED",
      snapshot: null,
      acceptedAt: NOW - 1000,
      createdAt: NOW - 2000,
      updatedAt: NOW - 1000,
    });
  });
}

describe("QUOTE_ACCEPTED / INVOICE_ISSUED", () => {
  test("accepting a quote moves a quoted job to AWAITING_PAYMENT", async () => {
    const t = makeT();
    await seedProject(t, "QUOTED");
    expect(await advance(t, "QUOTE_ACCEPTED")).toBe("AWAITING_PAYMENT");
  });

  test("issuing an invoice moves a job that was never formally accepted", async () => {
    const t = makeT();
    await seedProject(t, "ENQUIRY");
    expect(await advance(t, "INVOICE_ISSUED")).toBe("AWAITING_PAYMENT");
  });

  test("the second of the two is a no-op — they are two doors to one room", async () => {
    const t = makeT();
    await seedProject(t, "QUOTED");
    expect(await advance(t, "QUOTE_ACCEPTED")).toBe("AWAITING_PAYMENT");
    expect(await advance(t, "INVOICE_ISSUED")).toBeNull();
  });

  test("a balance invoice on a job already out on site never drags it back", async () => {
    const t = makeT();
    await seedProject(t, "ON_SITE");
    expect(await advance(t, "INVOICE_ISSUED")).toBeNull();
    expect(await projectStatus(t)).toBe("ON_SITE");
  });
});

describe("PAYMENT_SETTLED", () => {
  test("a settled invoice confirms the job", async () => {
    const t = makeT();
    await seedProject(t, "AWAITING_PAYMENT");
    await seedAcceptedQuote(t);
    expect(await advance(t, "PAYMENT_SETTLED")).toBe("CONFIRMED");
    expect(await projectStatus(t)).toBe("CONFIRMED");
  });

  test("fails CLOSED with no accepted quote — the manual confirm's own gate", async () => {
    // updateStatusNative demands a justification from a narrow audience to
    // confirm without an accepted revision. This path has nobody to ask, so it
    // must leave the job where it is rather than route around the gate.
    const t = makeT();
    await seedProject(t, "AWAITING_PAYMENT");
    expect(await advance(t, "PAYMENT_SETTLED")).toBeNull();
    expect(await projectStatus(t)).toBe("AWAITING_PAYMENT");
  });

  test("takes the same whole-project snapshot the manual confirm takes", async () => {
    const t = makeT();
    await seedProject(t, "AWAITING_PAYMENT");
    await seedAcceptedQuote(t);
    await advance(t, "PAYMENT_SETTLED");
    const snapshots = await t.run(async (ctx) => await ctx.db.query("projectSnapshots").collect());
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.reason).toBe("CONFIRMED");
    expect(snapshots[0]?.statusFrom).toBe("AWAITING_PAYMENT");
    expect(snapshots[0]?.statusTo).toBe("CONFIRMED");
  });

  test("never reaches a job that hasn't been through the money phase", async () => {
    const t = makeT();
    await seedProject(t, "QUOTED");
    await seedAcceptedQuote(t);
    expect(await advance(t, "PAYMENT_SETTLED")).toBeNull();
  });

  test("respects the org opt-out", async () => {
    const t = makeT();
    await seedProject(t, "AWAITING_PAYMENT");
    await seedAcceptedQuote(t);
    await optOut(t, "paymentSettled");
    expect(await advance(t, "PAYMENT_SETTLED")).toBeNull();
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

  test("starts prep straight out of AWAITING_PAYMENT (#1236 — the money phase is not a one-way door)", async () => {
    const t = makeT();
    await seedProject(t, "AWAITING_PAYMENT");
    expect(await advance(t, "PREP_STARTED")).toBe("PREPPING");
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
  test("advances once every deployable line has left the building", async () => {
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

  // The bug this condition was rewritten for. A bulk line rolls up to
  // `{ status: CHECKED_OUT, prepStatus: PACKED }` the moment its FIRST unit goes
  // out (deriveOrderLineStatus is a `some`), so the old "is any line still
  // PACKED?" test read one-of-three as "the dock is clear" and flipped the job
  // with two units still in the building — permanently, since the trigger's
  // `from` set no longer matched once it had moved.
  test("a partially deployed bulk line still holds the job back", async () => {
    const t = makeT();
    await seedProject(t, "PREPPING");
    await seedLine(t, "bulk", "CHECKED_OUT", "PACKED", { quantity: 3, checkedOutQuantity: 1 });
    expect(await advance(t, "ALL_CHECKED_OUT")).toBeNull();
    expect(await projectStatus(t)).toBe("PREPPING");
  });

  test("…and advances once the rest of that same line goes out", async () => {
    const t = makeT();
    await seedProject(t, "PREPPING");
    await seedLine(t, "bulk", "CHECKED_OUT", "PACKED", { quantity: 3, checkedOutQuantity: 3 });
    expect(await advance(t, "ALL_CHECKED_OUT")).toBe("CHECKED_OUT");
  });

  test("a partly returned line is not mistaken for a partly deployed one", async () => {
    const t = makeT();
    await seedProject(t, "PREPPING");
    // All 3 went out, 1 has come back: checkedOutQuantity is decremented on return.
    await seedLine(t, "bulk", "CHECKED_OUT", "PACKED", { quantity: 3, checkedOutQuantity: 2, returnedQuantity: 1 });
    expect(await advance(t, "ALL_CHECKED_OUT")).toBe("CHECKED_OUT");
  });

  // The second half of the same bug: "nothing is PACKED" was vacuously TRUE for
  // gear nobody had prepped yet, so deploying one item out of ten untouched
  // lines flipped the whole job to Deployed.
  test("never-prepped gear holds the job back — it is still in the building", async () => {
    const t = makeT();
    await seedProject(t, "PREPPING");
    await seedLine(t, "li1", "CHECKED_OUT", "PACKED");
    await seedLine(t, "li2", "CONFIRMED"); // no prepStatus, never picked
    expect(await advance(t, "ALL_CHECKED_OUT")).toBeNull();
    expect(await projectStatus(t)).toBe("PREPPING");
  });

  test("non-gear lines never hold the job back", async () => {
    const t = makeT();
    await seedProject(t, "PREPPING");
    await seedLine(t, "li1", "CHECKED_OUT", "PACKED");
    for (const type of ["SERVICE", "LABOUR", "TRANSPORT", "MISC", "SALE"]) {
      await seedLine(t, `ng_${type}`, "CONFIRMED", undefined, { type });
    }
    expect(await advance(t, "ALL_CHECKED_OUT")).toBe("CHECKED_OUT");
  });

  test("a container row is warehouse bookkeeping, not gear", async () => {
    const t = makeT();
    await seedProject(t, "PREPPING");
    await seedLine(t, "li1", "CHECKED_OUT", "PACKED");
    await seedLine(t, "case", "CONFIRMED", "PACKED", { isContainerLineItem: true });
    expect(await advance(t, "ALL_CHECKED_OUT")).toBe("CHECKED_OUT");
  });

  // A sub-hire GROUP wrapper is hidden by the warehouse page (its children show
  // individually) and is therefore never deployed itself. Backed by an indexed
  // `by_parentLineItemId` read, so it needs a real parent/child pair to prove.
  test("a sub-hire group wrapper doesn't hold the job back — its children carry the state", async () => {
    const t = makeT();
    await seedProject(t, "PREPPING");
    await seedLine(t, "wrap", "CONFIRMED", undefined, { subHireId: "sh1" });
    await seedLine(t, "shchild", "CHECKED_OUT", "PACKED", { subHireId: "sh1", parentLineItemId: "wrap" });
    expect(await advance(t, "ALL_CHECKED_OUT")).toBe("CHECKED_OUT");
  });

  test("…but a childless sub-hire line is ordinary gear and does hold it back", async () => {
    const t = makeT();
    await seedProject(t, "PREPPING");
    await seedLine(t, "li1", "CHECKED_OUT", "PACKED");
    await seedLine(t, "direct", "CONFIRMED", undefined, { subHireId: "sh2" });
    expect(await advance(t, "ALL_CHECKED_OUT")).toBeNull();
  });

  test("a cancelled or returned line is not still in the building", async () => {
    const t = makeT();
    await seedProject(t, "PREPPING");
    await seedLine(t, "li1", "CHECKED_OUT", "PACKED");
    await seedLine(t, "li2", "CANCELLED", "PACKED");
    await seedLine(t, "li3", "RETURNED", "PACKED");
    expect(await advance(t, "ALL_CHECKED_OUT")).toBe("CHECKED_OUT");
  });

  test("a job where nothing ever went out does not 'finish' deploying", async () => {
    const t = makeT();
    await seedProject(t, "PREPPING");
    await seedLine(t, "svc", "CONFIRMED", undefined, { type: "SERVICE" });
    expect(await advance(t, "ALL_CHECKED_OUT")).toBeNull();
  });

  // #1236 — the money phase must not be a one-way door for an org that never
  // records a payment in Flow.
  test("drags a job forward out of AWAITING_PAYMENT", async () => {
    const t = makeT();
    await seedProject(t, "AWAITING_PAYMENT");
    await seedLine(t, "li1", "CHECKED_OUT", "PACKED");
    expect(await advance(t, "ALL_CHECKED_OUT")).toBe("CHECKED_OUT");
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

});

// ─── pricingLocked — the #1230 × #1236 merge fix ───────────────────────────
//
// `sendNative` (D55) and `updateStatusNative`'s manual CONFIRMED transition
// both raise `projects.pricingLocked` — but TWO of this module's own paths
// reach AWAITING_PAYMENT/CONFIRMED without either of those ever having run
// (see `maybeAutoAdvanceProjectStatus`'s own doc comment). These tests pin
// the defensive raise that closes that gap.

describe("pricingLocked — defensive raise on first reaching AWAITING_PAYMENT/CONFIRMED", () => {
  test("INVOICE_ISSUED locks pricing for a job that never had a quote sent", async () => {
    const t = makeT();
    await seedProject(t, "ENQUIRY"); // no quote ever sent — pricingLocked absent
    await advance(t, "INVOICE_ISSUED");
    const project = await t.run(async (ctx) =>
      ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", PROJ)).first(),
    );
    expect(project?.status).toBe("AWAITING_PAYMENT");
    expect(project?.pricingLocked).toBe(true);
    expect(project?.pricingLockedById).toBe(ACTOR.userId);
  });

  test("QUOTE_ACCEPTED locks pricing when it wasn't already", async () => {
    const t = makeT();
    await seedProject(t, "QUOTED");
    await advance(t, "QUOTE_ACCEPTED");
    const project = await t.run(async (ctx) =>
      ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", PROJ)).first(),
    );
    expect(project?.pricingLocked).toBe(true);
  });

  test("is idempotent — does not re-stamp an already-locked project", async () => {
    const t = makeT();
    await seedProject(t, "QUOTED");
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", PROJ)).first();
      await ctx.db.patch(p!._id, {
        pricingLocked: true, pricingLockedAt: NOW - 5000, pricingLockedById: "user_other", pricingLockedByName: "Prior",
      });
    });
    await advance(t, "QUOTE_ACCEPTED");
    const project = await t.run(async (ctx) =>
      ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", PROJ)).first(),
    );
    expect(project?.pricingLockedAt).toBe(NOW - 5000); // untouched
    expect(project?.pricingLockedById).toBe("user_other");
  });

  test("PAYMENT_SETTLED locks pricing on the CONFIRMED transition too", async () => {
    const t = makeT();
    await seedProject(t, "AWAITING_PAYMENT");
    await seedAcceptedQuote(t);
    await advance(t, "PAYMENT_SETTLED");
    const project = await t.run(async (ctx) =>
      ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", PROJ)).first(),
    );
    expect(project?.status).toBe("CONFIRMED");
    expect(project?.pricingLocked).toBe(true);
  });

  test("the audit row records the lock only when it was actually just raised", async () => {
    const t = makeT();
    await seedProject(t, "ENQUIRY");
    await advance(t, "INVOICE_ISSUED");
    const log = await t.run(async (ctx) =>
      (await ctx.db.query("activityLogs").collect()).find((r) => r.action === "STATUS_CHANGE"),
    );
    expect(log?.summary).toContain("pricing locked");
    expect(log?.metadata).toMatchObject({ pricingLocked: true });
  });
});
