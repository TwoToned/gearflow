// @vitest-environment node
//
// convex/versions.ts — Phase 3 (#1229, parent #1221) of "Project versioning
// v2". Covers the four verbs (`createNative`/`makeLiveNative`/
// `setLabelNative`/`deleteNative`) that replace the older `projects.revision`/
// `liveRevision` + `projectSnapshots` promote-as-restore program
// (`convex/projectVersionsWrites.ts`'s deleted `saveVersionNative`/
// `promoteRevisionNative`, `convex/quotesWrites.ts`'s deleted
// `repriceFromRevisionNative`/`deleteDraftNative`/`deleteVersionNative`/
// `setQuoteProtectedNative`). See FEATUREDOCS/76's Phase 3 section.
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const actor = { userId: USER, userName: "Alice" };
const asUser = (orgId: string, userId = USER) => ({ subject: userId, orgId });

function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}
type T = ReturnType<typeof makeT>;

async function seedMember(t: T, role = "member", orgId = ORG, userId = USER) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: `m_${userId}_${orgId}`, organizationId: orgId, userId, role });
  });
}

/** A project with a REAL plan (dates/client/discount/notes) all set directly
 *  on `projects` — v1 is live, so its plan lives there, per schema.ts's own
 *  comment on `projectVersions`' PLAN FIELDS. */
async function seedProject(t: T, orgId = ORG, over: Partial<Doc<"projects">> = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: "p1", organizationId: orgId, projectNumber: "RVLT-2026-0087", name: "Gig",
      status: "QUOTING", isTemplate: false, liveVersionId: "v1",
      rentalStartDate: NOW, rentalEndDate: NOW + 5 * DAY,
      projectStartDate: NOW, projectEndDate: NOW + 5 * DAY,
      // discountAmount matches subtotal(200 = qty 2 x $100) x discountPercent(10%)
      // exactly — `discountAmount` is PLAN FIELD on `projectVersions` (schema.ts)
      // but ALSO a recalc-derived output on `projects` (convex/lib/recalc.ts);
      // seeding it already-consistent means make-live's recalc is a no-op on it,
      // so the round-trip test below isn't fighting recalc's own arithmetic.
      discountPercent: 10, discountAmount: 20, taxRate: 10, clientId: "c1",
      description: "A gig", crewNotes: "Bring the van",
      subtotal: 100, taxAmount: 10, total: 110,
      createdAt: NOW, updatedAt: NOW,
      ...over,
    });
    await ctx.db.insert("projectVersions", {
      id: "v1", organizationId: orgId, projectId: "p1", number: 1,
      contentState: "ready", createdAt: NOW, createdById: "u1",
    });
    await ctx.db.insert("projectLineItems", {
      id: "li1", organizationId: orgId, projectId: "p1", versionId: "v1", lineageId: "li1",
      status: "CONFIRMED", type: "EQUIPMENT", isKitChild: false, description: "PA System",
      quantity: 2, unitPrice: 100, lineTotal: 200, modelId: "mdl1",
    });
  });
}

const getProject = (t: T) => t.run((ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
const getVersion = (t: T, id: string) => t.run((ctx) => ctx.db.query("projectVersions").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const listVersions = (t: T) => t.run((ctx) => ctx.db.query("projectVersions").withIndex("by_projectId_number", (q) => q.eq("projectId", "p1")).collect());
const linesFor = (t: T, versionId: string) =>
  t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_versionId", (q) => q.eq("versionId", versionId)).collect());

/** Every PLAN_FIELDS key (convex/lib/versionPlanFields.ts), for the
 *  byte-identical round-trip assertion — kept as an explicit local list
 *  (rather than importing the module) so the test doesn't silently pass if
 *  the source list is accidentally emptied. */
const PLAN_FIELD_KEYS = [
  "rentalStartDate", "rentalEndDate", "projectStartDate", "projectStartTime", "projectEndDate", "projectEndTime",
  "loadInDate", "loadInTime", "eventStartDate", "eventStartTime", "eventEndDate", "eventEndTime",
  "loadOutDate", "loadOutTime", "billingWeeksOverride", "billingDaysOverride", "taxRate",
  "discountPercent", "discountAmount", "depositPercent", "clientId", "clientContactId", "locationId",
  "siteContactName", "siteContactPhone", "siteContactEmail", "type", "description", "crewNotes",
  "internalNotes", "clientNotes",
] as const;
function planSnapshot(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of PLAN_FIELD_KEYS) out[k] = doc[k];
  return out;
}

const createArgs = (over: Partial<Record<string, unknown>> = {}) => ({
  organizationId: ORG, projectId: "p1", actor, auditId: "aCreate", now: NOW, ...over,
});
const create = (t: T, over: Partial<Record<string, unknown>> = {}, orgId = ORG) =>
  t.withIdentity(asUser(orgId)).mutation(api.versions.createNative, createArgs({ organizationId: orgId, ...over }) as never);

const makeLiveArgs = (versionId: string, over: Partial<Record<string, unknown>> = {}) => ({
  organizationId: ORG, projectId: "p1", versionId, actor, auditId: "aLive", now: NOW, ...over,
});
const makeLive = (t: T, versionId: string, over: Partial<Record<string, unknown>> = {}) =>
  t.withIdentity(asUser(ORG)).mutation(api.versions.makeLiveNative, makeLiveArgs(versionId, over) as never);

describe("versions.createNative", () => {
  test("copies the live version's plan graph into a fresh, non-live version — live tables/pointer untouched", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);

    const result = await create(t, { label: "with LED wall" });
    expect(result.number).toBe(2);

    const project = await getProject(t);
    expect(project?.liveVersionId).toBe("v1"); // never touched by create

    const v2 = await getVersion(t, result.id);
    expect(v2?.contentState).toBe("ready");
    expect(v2?.basedOnVersionId).toBe("v1");
    expect(v2?.label).toBe("with LED wall");
    expect(v2?.discountPercent).toBe(10); // snapshotted off `projects` (v1 is live)
    expect(v2?.clientId).toBe("c1");

    const v1Lines = await linesFor(t, "v1");
    const v2Lines = await linesFor(t, result.id);
    expect(v1Lines).toHaveLength(1); // untouched
    expect(v2Lines).toHaveLength(1);
    expect(v2Lines[0].id).not.toBe("li1");
    expect(v2Lines[0].lineageId).toBe("li1"); // lineage preserved across the clone
    expect(v2Lines[0].unitPrice).toBe(100);
  });

  test("defaults fromVersionId to the project's live version", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);

    const result = await create(t);
    const v2 = await getVersion(t, result.id);
    expect(v2?.basedOnVersionId).toBe("v1");
  });

  test("can create from an explicit non-live source version", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    const v2 = await create(t, { label: "branch A" });
    const v3 = await create(t, { fromVersionId: v2.id, label: "branch A.1" });

    expect(v3.number).toBe(3);
    const v3Doc = await getVersion(t, v3.id);
    expect(v3Doc?.basedOnVersionId).toBe(v2.id);
    const v3Lines = await linesFor(t, v3.id);
    expect(v3Lines[0].lineageId).toBe("li1"); // lineage survives a two-hop clone
  });

  test("allocates the next number off the current max among EXISTING versions", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    const v2 = await create(t); // number 2
    const v3 = await create(t); // number 3, v2 still exists
    expect(v3.number).toBe(3);

    // Deleting the highest-numbered version and creating again allocates off
    // whatever's LEFT (schema.ts's own prescription for this allocator: "read
    // this project's current max" — there is no separate persistent counter,
    // unlike the older `projects.revision` allocator). Not a footgun in
    // practice: a freshly-deleted version's number was never live and never
    // referenced by anything that survives the delete.
    await t.withIdentity(asUser(ORG)).mutation(api.versions.deleteNative, {
      organizationId: ORG, projectId: "p1", versionId: v3.id, actor, auditId: "aDel", now: NOW,
    } as never);
    const v3Again = await create(t);
    expect(v3Again.number).toBe(3); // reused — v2 (number 2) is still the max survivor
  });

  test("rejects a template project", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t, ORG, { isTemplate: true });
    await expect(create(t)).rejects.toThrow(/templates don't have versions/i);
  });

  test("rejects a source version with no captured content", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectVersions", { id: "vMissing", organizationId: ORG, projectId: "p1", number: 2, contentState: "missing", createdAt: NOW, createdById: "u1" });
    });
    await expect(create(t, { fromVersionId: "vMissing" })).rejects.toThrow(/no captured content/i);
  });

  test("enforces the server-side label bound regardless of client validation", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await expect(create(t, { label: "x".repeat(61) })).rejects.toThrow(/at most 60/i);
  });

  test("a viewer (project:read only) is denied", async () => {
    const t = makeT();
    await seedMember(t, "viewer");
    await seedProject(t);
    await expect(create(t)).rejects.toThrow(/insufficient permissions/i);
  });

  test("rejects a cross-org project (IDOR guard)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t, OTHER);
    await expect(create(t)).rejects.toThrow(/not found in your organization/i);
  });
});

describe("versions.makeLiveNative", () => {
  test("flips liveVersionId and recalcs totals off the newly-live version's own rows", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    const v2 = await create(t);
    // Diverge v2's clone so recalc's output is provably keyed off v2, not v1.
    await t.run(async (ctx) => {
      const [line] = await ctx.db.query("projectLineItems").withIndex("by_versionId", (q) => q.eq("versionId", v2.id)).collect();
      await ctx.db.patch(line._id, { unitPrice: 500, lineTotal: 1000 });
    });

    const result = await makeLive(t, v2.id);
    expect(result.liveVersionId).toBe(v2.id);
    expect(result.previousLiveVersionId).toBe("v1");

    const project = await getProject(t);
    expect(project?.liveVersionId).toBe(v2.id);
    expect(project?.subtotal).toBe(1000); // recalculated off v2's (diverged) line, not v1's
  });

  // The core Phase 3 acceptance criterion: make-live in both directions
  // returns the project to byte-identical PLAN state.
  test("make-live is a pointer flip — round trip v1 -> v2 -> v1 is byte-identical on the project's plan fields", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    const before = planSnapshot((await getProject(t))!);

    const v2 = await create(t);
    await makeLive(t, v2.id, { auditId: "aLive1" });
    const midway = planSnapshot((await getProject(t))!);
    expect(midway).toEqual(before); // v2 was cloned FROM v1, so the plan hasn't actually changed

    await makeLive(t, "v1", { auditId: "aLive2", now: NOW + 1 });
    const after = planSnapshot((await getProject(t))!);
    expect(after).toEqual(before);

    const project = await getProject(t);
    expect(project?.liveVersionId).toBe("v1"); // back where it started
  });

  test("no auto-capture, nothing overwritten — both versions' own rows survive untouched after the flip", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    const v2 = await create(t);

    await makeLive(t, v2.id);

    const v1Lines = await linesFor(t, "v1");
    const v2Lines = await linesFor(t, v2.id);
    expect(v1Lines).toHaveLength(1); // v1's row still exists, untouched
    expect(v2Lines).toHaveLength(1);
  });

  test("carries reality onto the matching incoming line by lineageId", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItemUnits", {
        id: "u1", organizationId: ORG, lineItemId: "li1", ordinal: 0, assetId: "a1", status: "CHECKED_OUT",
      });
      await ctx.db.insert("checkRecords", {
        id: "cr1", organizationId: ORG, context: "PREP", lineItemId: "li1", checkItemId: "ci1",
        checkItemLabelSnapshot: "Powers on", checkItemTypeSnapshot: "PASS_FAIL", result: "PASS", performedById: USER,
      });
    });
    const v2 = await create(t); // clones li1 -> a NEW id, SAME lineageId "li1"

    await makeLive(t, v2.id);

    const [v2Line] = await linesFor(t, v2.id);
    const unit = await t.run((ctx) => ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", "u1")).first());
    const check = await t.run((ctx) => ctx.db.query("checkRecords").withIndex("by_cuid", (q) => q.eq("id", "cr1")).first());
    expect(unit?.lineItemId).toBe(v2Line.id);
    expect(check?.lineItemId).toBe(v2Line.id);
  });

  test("orphaned reality (no lineage match) becomes an unplanned line on the incoming version", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItemUnits", {
        id: "u1", organizationId: ORG, lineItemId: "li1", ordinal: 0, assetId: "a1", status: "CHECKED_OUT",
      });
    });
    // v2 has NO line at all (an empty version) — nothing shares li1's lineageId.
    const v2 = await create(t, { label: "empty" });
    await t.run(async (ctx) => {
      const lines = await ctx.db.query("projectLineItems").withIndex("by_versionId", (q) => q.eq("versionId", v2.id)).collect();
      for (const line of lines) await ctx.db.delete(line._id);
    });

    const result = await makeLive(t, v2.id);
    expect(result.unplannedLineItemIds).toHaveLength(1);

    const unplanned = await t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", result.unplannedLineItemIds[0])).first());
    expect(unplanned?.unplanned).toBe(true);
    expect(unplanned?.unitPrice).toBe(0);
    expect(unplanned?.versionId).toBe(v2.id);
    expect(unplanned?.lineageId).toBe("li1");

    const unit = await t.run((ctx) => ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", "u1")).first());
    expect(unit?.lineItemId).toBe(unplanned?.id);
  });

  test("a matched line planning less than what's already checked out is a listed CONFLICT, never blocked", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItemUnits", { id: "u1", organizationId: ORG, lineItemId: "li1", ordinal: 0, status: "CHECKED_OUT" });
      await ctx.db.insert("projectLineItemUnits", { id: "u2", organizationId: ORG, lineItemId: "li1", ordinal: 1, status: "CHECKED_OUT" });
    });
    const v2 = await create(t);
    await t.run(async (ctx) => {
      const [line] = await ctx.db.query("projectLineItems").withIndex("by_versionId", (q) => q.eq("versionId", v2.id)).collect();
      await ctx.db.patch(line._id, { quantity: 1 }); // plans only 1, but 2 are already checked out
    });

    const result = await makeLive(t, v2.id);
    expect(result.conflicts.some((c) => /2 unit/.test(c) && /plans only 1/.test(c))).toBe(true);
    // Not blocked — the make-live still succeeded.
    expect((await getProject(t))?.liveVersionId).toBe(v2.id);
  });

  test("D6 — succeeds even with a non-VOID ISSUED invoice on the project", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("invoices", {
        id: "inv1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", status: "ISSUED",
        subtotal: 100, taxAmount: 10, total: 110,
      });
    });
    const v2 = await create(t);

    const result = await makeLive(t, v2.id);
    expect(result.liveVersionId).toBe(v2.id);
    // The invoice's own stored total is untouched/still readable (D6).
    const invoice = await t.run((ctx) => ctx.db.query("invoices").withIndex("by_cuid", (q) => q.eq("id", "inv1")).first());
    expect(invoice?.total).toBe(110);
  });

  test("D37/D39 — no lock gate: succeeds on a HARD_LOCKED (COMPLETED) project with no open unlock session", async () => {
    const t = makeT();
    await seedMember(t, "owner");
    await seedProject(t, ORG, { status: "COMPLETED" });
    const v2 = await create(t);

    const result = await makeLive(t, v2.id);
    expect(result.liveVersionId).toBe(v2.id);
  });

  test("rejects making the already-live version live again", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await expect(makeLive(t, "v1")).rejects.toThrow(/already live/i);
  });

  test("rejects a target version with no captured content", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectVersions", { id: "vMissing", organizationId: ORG, projectId: "p1", number: 2, contentState: "missing", createdAt: NOW, createdById: "u1" });
    });
    await expect(makeLive(t, "vMissing")).rejects.toThrow(/no captured content/i);
  });

  test("a viewer is denied", async () => {
    const t = makeT();
    await seedMember(t, "viewer");
    await seedProject(t);
    const v2Id = await t.run(async (ctx) => {
      const id = "v2seed";
      await ctx.db.insert("projectVersions", { id, organizationId: ORG, projectId: "p1", number: 2, contentState: "ready", createdAt: NOW, createdById: "u1" });
      return id;
    });
    await expect(makeLive(t, v2Id)).rejects.toThrow(/insufficient permissions/i);
  });

  test("rejects a version belonging to another org (IDOR guard)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    // A version that exists, but under a DIFFERENT org's data entirely.
    await t.run(async (ctx) => {
      await ctx.db.insert("projectVersions", {
        id: "v-other-org", organizationId: OTHER, projectId: "p1", number: 2, contentState: "ready", createdAt: NOW, createdById: "u1",
      });
    });
    await expect(makeLive(t, "v-other-org")).rejects.toThrow(/not found or cross-org/i);
  });

  // D54 (#1230): make-live is a pointer flip over the PLAN graph — it must
  // never touch `projects.pricingLocked` in either direction, locked or
  // unlocked, forward or backward.
  test("D54: never touches projects.pricingLocked, whether starting locked or unlocked", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    const v2 = await create(t);

    // Starting unlocked — stays unlocked after the flip.
    await makeLive(t, v2.id, { auditId: "aLive1" });
    expect((await getProject(t))?.pricingLocked).toBeFalsy();

    // Starting locked — stays locked (both value and stamped who/when) after
    // flipping back to v1.
    await t.run(async (ctx) => {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first();
      await ctx.db.patch(p!._id, { pricingLocked: true, pricingLockedAt: NOW, pricingLockedById: USER, pricingLockedByName: "Alice" });
    });
    await makeLive(t, "v1", { auditId: "aLive2", now: NOW + 1 });
    const project = await getProject(t);
    expect(project?.liveVersionId).toBe("v1");
    expect(project?.pricingLocked).toBe(true);
    expect(project?.pricingLockedAt).toBe(NOW);
    expect(project?.pricingLockedById).toBe(USER);
  });
});

describe("versions.setLabelNative", () => {
  test("sets and clears a version's label", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    const v2 = await create(t);

    const set = await t.withIdentity(asUser(ORG)).mutation(api.versions.setLabelNative, {
      organizationId: ORG, projectId: "p1", versionId: v2.id, label: "Budget option", actor, auditId: "aSet", now: NOW,
    } as never);
    expect(set.label).toBe("Budget option");
    expect((await getVersion(t, v2.id))?.label).toBe("Budget option");

    const cleared = await t.withIdentity(asUser(ORG)).mutation(api.versions.setLabelNative, {
      organizationId: ORG, projectId: "p1", versionId: v2.id, actor, auditId: "aClear", now: NOW,
    } as never);
    expect(cleared.label).toBeNull();
    expect((await getVersion(t, v2.id))?.label).toBeUndefined();
  });

  test("enforces the label bound", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.versions.setLabelNative, {
        organizationId: ORG, projectId: "p1", versionId: "v1", label: "x".repeat(61), actor, auditId: "a", now: NOW,
      } as never),
    ).rejects.toThrow(/at most 60/i);
  });

  test("rejects a cross-org version", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.versions.setLabelNative, {
        organizationId: ORG, projectId: "p1", versionId: "does-not-exist", label: "x", actor, auditId: "a", now: NOW,
      } as never),
    ).rejects.toThrow(/not found or cross-org/i);
  });
});

describe("versions.deleteNative", () => {
  test("deletes a non-live version and every plan row it owns", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    const v2 = await create(t);
    expect(await linesFor(t, v2.id)).toHaveLength(1);

    const result = await t.withIdentity(asUser(ORG)).mutation(api.versions.deleteNative, {
      organizationId: ORG, projectId: "p1", versionId: v2.id, actor, auditId: "aDel", now: NOW,
    } as never);
    expect(result.number).toBe(2);

    expect(await getVersion(t, v2.id)).toBeNull();
    expect(await linesFor(t, v2.id)).toHaveLength(0);
    // The live version's own rows are untouched.
    expect(await linesFor(t, "v1")).toHaveLength(1);
  });

  test("refuses to delete the LIVE version", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.versions.deleteNative, {
        organizationId: ORG, projectId: "p1", versionId: "v1", actor, auditId: "aDel", now: NOW,
      } as never),
    ).rejects.toThrow(/is live/i);
  });

  test("rejects a cross-org version", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.versions.deleteNative, {
        organizationId: ORG, projectId: "p1", versionId: "does-not-exist", actor, auditId: "aDel", now: NOW,
      } as never),
    ).rejects.toThrow(/not found or cross-org/i);
  });
});
