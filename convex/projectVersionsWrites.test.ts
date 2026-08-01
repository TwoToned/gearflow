// @vitest-environment node
//
// convex/projectVersionsWrites.ts — Phase 1 of the project-version-switching
// program (#1080/#1085). Verifies `saveVersionNative`'s "freeze a copy, carry
// on" shape, the capture `newVersionNative` now performs on the revision it
// moves past, the liveRevision pointer staying in lockstep with the allocator
// throughout Phase 1, the one-live-DRAFT invariant across save/send/new
// version/recall, cross-tenant IDOR protection, RBAC, and the server-side
// label bound (bypassing the client Zod parse).
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
const actor = { userId: USER, userName: "Alice" };
const asUser = (orgId: string) => ({ subject: USER, orgId });

function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seedMember(t: ReturnType<typeof makeT>, role = "owner", orgId = ORG, userId = USER) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: `m_${userId}_${orgId}`, organizationId: orgId, userId, role });
  });
}

async function seedProject(t: ReturnType<typeof makeT>, orgId = ORG, over: Partial<Doc<"projects">> = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: "p1", organizationId: orgId, projectNumber: "RVLT-2026-0087", name: "Gig",
      status: "QUOTING", isTemplate: false, revision: 1,
      subtotal: 100, discountAmount: 0, taxAmount: 10, total: 110, taxRate: 10,
      createdAt: NOW, updatedAt: NOW,
      ...over,
    });
    await ctx.db.insert("projectLineItems", {
      id: "l1", organizationId: orgId, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT",
      isKitChild: false, isOptional: false, description: "PA System", quantity: 1, unitPrice: 100, lineTotal: 100,
    });
  });
}

const getQuotes = (t: ReturnType<typeof makeT>) =>
  t.run(async (ctx) => ctx.db.query("quotes").withIndex("by_projectId", (q) => q.eq("projectId", "p1")).collect());
const getProject = (t: ReturnType<typeof makeT>) =>
  t.run(async (ctx) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", "p1")).first());
const getSnapshots = (t: ReturnType<typeof makeT>) =>
  t.run(async (ctx) => ctx.db.query("projectSnapshots").withIndex("by_projectId", (q) => q.eq("projectId", "p1")).collect());

const saveArgs = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "qSave", organizationId: ORG, projectId: "p1", actor, auditId: "aSave", now: NOW, ...over,
});
const saveVersion = (t: ReturnType<typeof makeT>, over: Partial<Record<string, unknown>> = {}) =>
  t.withIdentity(asUser(ORG)).mutation(api.projectVersionsWrites.saveVersionNative, saveArgs(over) as never);

const sendArgs = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "q1", organizationId: ORG, projectId: "p1", quoteDate: NOW, actor, auditId: "a1", now: NOW, ...over,
});
const send = (t: ReturnType<typeof makeT>, over: Partial<Record<string, unknown>> = {}) =>
  t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.sendNative, sendArgs(over) as never);

describe("projectVersionsWrites.saveVersionNative", () => {
  test("freezes the current live (never-sent) draft and opens a fresh one, live tables untouched", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);

    const result = await saveVersion(t, { label: "with LED wall" });
    expect(result).toEqual({ id: "qSave", version: 2, savedRevision: 1 });

    const project = await getProject(t);
    expect(project?.revision).toBe(2);
    expect(project?.liveRevision).toBe(2);
    // The live tables — the whole point of "save" vs. "promote" — are untouched.
    expect(project?.subtotal).toBe(100);
    const line = await t.run(async (ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", "l1")).first());
    expect(line?.unitPrice).toBe(100);

    const quotes = await getQuotes(t);
    expect(quotes.find((q) => q.id === "qSave")?.status).toBe("DRAFT");
    expect(quotes.find((q) => q.id === "qSave")?.version).toBe(2);
    expect(quotes.find((q) => q.id === "qSave")?.snapshot).toBeNull();

    const snapshots = await getSnapshots(t);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.reason).toBe("VERSION_SAVED");
    expect(snapshots[0]?.revision).toBe(1);
  });

  test("saving a project with no quote row yet still works — nothing to point a snapshotId at", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    expect(await getQuotes(t)).toHaveLength(0);

    const result = await saveVersion(t);
    expect(result.version).toBe(2);
    expect((await getProject(t))?.liveRevision).toBe(2);
    const quotes = await getQuotes(t);
    // Only the fresh v2 draft exists — v1 was never a real row.
    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.version).toBe(2);
  });

  test("saving on a SENT live revision points its snapshotId at the fresh capture, leaves its status alone", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t);
    const sentSnapshotId = (await getQuotes(t)).find((q) => q.id === "q1")?.snapshotId;

    await saveVersion(t, { now: NOW + 1 });

    const quotes = await getQuotes(t);
    const q1 = quotes.find((q) => q.id === "q1");
    // Still SENT — save version never sends/supersedes anything.
    expect(q1?.status).toBe("SENT");
    expect(q1?.version).toBe(1);
    expect(q1?.snapshotId).not.toBe(sentSnapshotId); // repointed at the fresh VERSION_SAVED capture
    expect(quotes.find((q) => q.id === "qSave")?.version).toBe(2);

    const project = await getProject(t);
    expect(project?.revision).toBe(2);
    expect(project?.liveRevision).toBe(2);
  });

  test("label is bounded server-side even when the client Zod parse is bypassed", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);

    await expect(saveVersion(t, { label: "x".repeat(61) })).rejects.toThrow(/at most 60 characters/i);
  });

  test("rejects a template project", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t, ORG, { isTemplate: true, revision: undefined });

    await expect(saveVersion(t)).rejects.toThrow(/templates don't have quotes/i);
  });

  test("a viewer is denied", async () => {
    const t = makeT();
    await seedMember(t, "viewer");
    await seedProject(t);

    await expect(saveVersion(t)).rejects.toThrow(/insufficient permissions/i);
  });

  test("rejects a cross-org projectId (IDOR guard)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t, OTHER);

    await expect(saveVersion(t)).rejects.toThrow(/not found in your organization/i);
  });
});

describe("quotesWrites.newVersionNative — captures the revision it moves past (#1085)", () => {
  test("captures a VERSION_SAVED snapshot onto the outgoing SENT revision and moves liveRevision", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await send(t);

    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.newVersionNative, {
      id: "q2", organizationId: ORG, projectId: "p1", actor, auditId: "a2", now: NOW + 1,
    });

    const snapshots = await getSnapshots(t);
    expect(snapshots.map((s) => s.reason).sort()).toEqual(["QUOTE_SENT", "VERSION_SAVED"]);
    const versionSaved = snapshots.find((s) => s.reason === "VERSION_SAVED");
    expect(versionSaved?.revision).toBe(1);

    const quotes = await getQuotes(t);
    expect(quotes.find((q) => q.id === "q1")?.snapshotId).toBe(versionSaved?.id);

    const project = await getProject(t);
    expect(project?.revision).toBe(2);
    expect(project?.liveRevision).toBe(2);
  });
});

describe("the one-live-DRAFT invariant (#1085) — save -> send -> new version -> recall", () => {
  /** A v1 DRAFT row pre-existing (as `backfillQuoteRevisions.ts` would leave
   *  one, or one dating from before Save Version's own lazy-creation was a
   *  thing) — the shape that lets Save Version leave an ORPHANED draft
   *  behind, rather than the "nothing at v1 yet" case another test covers. */
  async function seedV1Draft(t: ReturnType<typeof makeT>) {
    await t.run(async (ctx) => {
      await ctx.db.insert("quotes", {
        id: "q1", organizationId: ORG, projectId: "p1", version: 1, status: "DRAFT",
        snapshot: null, createdAt: NOW, updatedAt: NOW,
      });
    });
  }

  test("a saved-but-never-sent draft is left behind, non-live, and doesn't confuse the live-draft finders", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await seedV1Draft(t);

    // save v1 (never sent) -> v2 is live, v1 is an orphaned never-sent draft.
    await saveVersion(t, { id: "qOrphan", now: NOW });
    let quotes = await getQuotes(t);
    expect(quotes.filter((q) => q.status === "DRAFT")).toHaveLength(2); // v1 AND v2 — the invariant this phase changes

    // send v2 (the existing "qOrphan" draft row — sendNative reuses it rather
    // than inserting a second row at version 2), then cut v3 (captures v2),
    // send v3, then recall v3.
    await send(t, { id: "ignored", auditId: "a2", now: NOW + 1 });
    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.newVersionNative, {
      id: "q3", organizationId: ORG, projectId: "p1", actor, auditId: "a3", now: NOW + 2,
    });
    await send(t, { id: "ignored2", auditId: "a4", now: NOW + 3 });
    await t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.recallNative, {
      id: "q3", organizationId: ORG, reason: "Wrong rental window", actor, auditId: "a5", now: NOW + 4,
    });

    const project = await getProject(t);
    // recall doesn't touch revision/liveRevision — v3 stays the live (now-DRAFT-again) revision.
    expect(project?.revision).toBe(3);
    expect(project?.liveRevision).toBe(3);

    quotes = await getQuotes(t);
    expect(quotes.find((q) => q.id === "q3")?.status).toBe("DRAFT");
    expect(quotes.find((q) => q.id === "qOrphan")?.status).toBe("SENT"); // un-superseded by the recall

    // revisionStateForProject must report v3 (the LIVE draft), never the
    // orphaned v1 draft, as "the" open draft.
    const state = await t
      .withIdentity(asUser(ORG))
      .query(api.quotes.revisionStateForProject, { orgId: ORG, projectId: "p1", now: NOW + 4 });
    expect(state.draftQuoteId).toBe("q3");
  });

  test("deleteDraftNative refuses to touch a non-live never-sent draft, and doesn't corrupt the live counters", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t);
    await seedV1Draft(t); // "q1" at v1, never sent

    await saveVersion(t, { id: "qLive", now: NOW }); // v1 ("q1") orphaned, v2 ("qLive") live

    await expect(
      t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.deleteDraftNative, {
        id: "q1", organizationId: ORG, actor, auditId: "aDel", now: NOW + 1,
      }),
    ).rejects.toThrow(/saved version, not the live draft/i);

    // Nothing was touched by the rejected call.
    const project = await getProject(t);
    expect(project?.revision).toBe(2);
    expect(project?.liveRevision).toBe(2);
    expect(await getQuotes(t)).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Phase 2 (#1080/#1089) — promoteRevisionNative
// ─────────────────────────────────────────────────────────────────────────

/** Insert a `projectSnapshots` row + its `projectSnapshotEntries` directly —
 *  gives full control over a target/outgoing revision's captured state
 *  without running the real save/send flow for every scenario. */
async function seedSnapshotAt(
  t: ReturnType<typeof makeT>,
  revision: number,
  reason: "QUOTE_SENT" | "VERSION_SAVED" | "PRE_PROMOTE",
  opts: { project?: Record<string, unknown>; lineItems?: Record<string, unknown>[]; takenAt?: number } = {},
): Promise<string> {
  const snapshotId = `snap_v${revision}`;
  await t.run(async (ctx) => {
    await ctx.db.insert("projectSnapshots", {
      id: snapshotId, organizationId: ORG, projectId: "p1", reason, revision,
      takenAt: opts.takenAt ?? NOW, takenBy: USER,
    });
    const projectData = {
      id: "p1", organizationId: ORG, projectNumber: "RVLT-2026-0087", name: "Gig",
      status: "CONFIRMED", isTemplate: false, revision, liveRevision: revision,
      subtotal: 100, discountAmount: 0, taxAmount: 10, total: 110, taxRate: 10, margin: 20,
      discountPercent: 0, rentalStartDate: NOW, rentalEndDate: NOW + 5 * 86_400_000,
      invoicedTotal: 0, depositPaid: 0,
      createdAt: NOW, updatedAt: NOW,
      ...opts.project,
    };
    await ctx.db.insert("projectSnapshotEntries", {
      id: `${snapshotId}_proj`, organizationId: ORG, snapshotId, entityType: "project", entityId: "p1", data: projectData,
    });
    for (const li of opts.lineItems ?? []) {
      await ctx.db.insert("projectSnapshotEntries", {
        id: `${snapshotId}_${li.id}`, organizationId: ORG, snapshotId, entityType: "lineItem", entityId: li.id as string, data: li,
      });
    }
  });
  return snapshotId;
}

const promoteArgs = (targetRevision: number, over: Partial<Record<string, unknown>> = {}) => ({
  organizationId: ORG, projectId: "p1", targetRevision, actor, auditId: "aPromote", now: NOW, ...over,
});
const promote = (t: ReturnType<typeof makeT>, targetRevision: number, over: Partial<Record<string, unknown>> = {}) =>
  t.withIdentity(asUser(ORG)).mutation(api.projectVersionsWrites.promoteRevisionNative, promoteArgs(targetRevision, over) as never);

const getLineItems = (t: ReturnType<typeof makeT>) =>
  t.run(async (ctx) => ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", "p1")).collect());

describe("promoteRevisionNative — preconditions, checked in order", () => {
  test("rejects a template project", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t, ORG, { isTemplate: true, revision: 2, liveRevision: 2 });
    await seedSnapshotAt(t, 1, "VERSION_SAVED");

    await expect(promote(t, 1)).rejects.toThrow(/templates don't have versions/i);
  });

  test("rejects promoting the already-live revision", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t, ORG, { revision: 1, liveRevision: 1 });

    await expect(promote(t, 1)).rejects.toThrow(/already live/i);
  });

  test("rejects a target revision with no captured state", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t, ORG, { revision: 2, liveRevision: 2 });
    // No snapshot exists at v1 or v3 — neither is restorable.

    await expect(promote(t, 1)).rejects.toThrow(/no captured state/i);
    await expect(promote(t, 3)).rejects.toThrow(/no captured state/i);
  });

  test("a plain member (project:update but not admin/owner/PM) is forbidden", async () => {
    const t = makeT();
    await seedMember(t, "member");
    await seedProject(t, ORG, { revision: 2, liveRevision: 2 });
    await seedSnapshotAt(t, 1, "VERSION_SAVED");

    await expect(promote(t, 1)).rejects.toThrow(/admins\/owners or this project's assigned pm/i);
  });

  test("a member who is also the project's assigned PM is allowed", async () => {
    const t = makeT();
    await seedMember(t, "member");
    await seedProject(t, ORG, { revision: 2, liveRevision: 2 });
    await seedSnapshotAt(t, 1, "VERSION_SAVED");
    await t.run(async (ctx) => {
      await ctx.db.insert("projectManagers", { id: "pm1", organizationId: ORG, projectId: "p1", userId: USER, addedAt: NOW });
    });

    const result = await promote(t, 1);
    expect(result.liveRevision).toBe(1);
  });

  test("an admin (no PM assignment needed) is allowed", async () => {
    const t = makeT();
    await seedMember(t, "admin");
    await seedProject(t, ORG, { revision: 2, liveRevision: 2 });
    await seedSnapshotAt(t, 1, "VERSION_SAVED");

    const result = await promote(t, 1);
    expect(result.liveRevision).toBe(1);
  });

  test("a HARD_LOCKED project (COMPLETED) with no open FULL session is rejected", async () => {
    const t = makeT();
    await seedMember(t, "owner");
    await seedProject(t, ORG, { revision: 2, liveRevision: 2, status: "COMPLETED" });
    await seedSnapshotAt(t, 1, "VERSION_SAVED");

    await expect(promote(t, 1)).rejects.toThrow(/hard-locked|full unlock session/i);
  });

  test("a HARD_LOCKED project WITH an open FULL session is allowed", async () => {
    const t = makeT();
    await seedMember(t, "owner");
    await seedProject(t, ORG, { revision: 2, liveRevision: 2, status: "COMPLETED" });
    await seedSnapshotAt(t, 1, "VERSION_SAVED");
    await t.withIdentity(asUser(ORG)).mutation(api.projectUnlockSessionsWrites.openNative, {
      projectId: "p1", orgId: ORG, scope: "FULL", justification: "Client requested we revert pricing to the original quote.",
      actor, auditId: "aOpen", now: NOW,
    });

    const result = await promote(t, 1);
    expect(result.liveRevision).toBe(1);
  });

  test("blocked while a non-VOID ISSUED invoice exists on the project", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t, ORG, { revision: 2, liveRevision: 2 });
    await seedSnapshotAt(t, 1, "VERSION_SAVED");
    await t.run(async (ctx) => {
      await ctx.db.insert("invoices", {
        id: "inv1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", status: "ISSUED",
        subtotal: 100, taxAmount: 10, total: 110,
      });
    });

    await expect(promote(t, 1)).rejects.toThrow(/already been issued/i);
  });

  test("a VOID invoice does NOT block promote", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t, ORG, { revision: 2, liveRevision: 2 });
    await seedSnapshotAt(t, 1, "VERSION_SAVED");
    await t.run(async (ctx) => {
      await ctx.db.insert("invoices", {
        id: "inv1", organizationId: ORG, projectId: "p1", clientId: "c1", kind: "FULL", status: "VOID",
        subtotal: 100, taxAmount: 10, total: 110,
      });
    });

    const result = await promote(t, 1);
    expect(result.liveRevision).toBe(1);
  });

  test("rejects a cross-org projectId (IDOR guard)", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t, OTHER, { revision: 2, liveRevision: 2 });

    await expect(promote(t, 1)).rejects.toThrow(/not found in your organization/i);
  });
});

describe("promoteRevisionNative — auto-capture rule", () => {
  test("branch 1: live revision never captured — captured onto its own number, no new quote row", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t, ORG, { revision: 2, liveRevision: 2 }); // v2 live, no snapshot at v2 yet
    await seedSnapshotAt(t, 1, "VERSION_SAVED");

    const result = await promote(t, 1);
    expect(result.autoSavedRevision).toBeUndefined();

    const project = await getProject(t);
    expect(project?.revision).toBe(2); // allocator untouched — no new number
    expect(project?.liveRevision).toBe(1);

    const snapshots = await getSnapshots(t);
    const preCapture = snapshots.find((s) => s.reason === "PRE_PROMOTE");
    expect(preCapture?.revision).toBe(2); // captured onto the OUTGOING live revision itself
    expect(await getQuotes(t)).toHaveLength(0); // nothing to point snapshotId at — no row existed
  });

  test("branch 2: live revision already captured and has drifted — allocates M, opens a labelled auto-saved draft", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t, ORG, { revision: 2, liveRevision: 2 });
    await seedSnapshotAt(t, 1, "VERSION_SAVED");
    // v2 was sent, but a structural line-item add since then means the LIVE
    // state now differs from that sent snapshot.
    await seedSnapshotAt(t, 2, "QUOTE_SENT", { lineItems: [{ id: "l1", organizationId: ORG, projectId: "p1", unitPrice: 100, quantity: 1 }] });
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", {
        id: "l_new", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT",
        isKitChild: false, isOptional: false, description: "Extra speaker", quantity: 1, unitPrice: 50, lineTotal: 50,
      });
    });

    const result = await promote(t, 1);
    expect(result.autoSavedRevision).toBe(3);

    const project = await getProject(t);
    expect(project?.revision).toBe(3); // allocator bumped to the new number
    expect(project?.liveRevision).toBe(1);

    const quotes = await getQuotes(t);
    const autoSaved = quotes.find((q) => q.version === 3);
    expect(autoSaved?.status).toBe("DRAFT");
    expect(autoSaved?.label).toMatch(/auto-saved before switching to v1/i);

    const snapshots = await getSnapshots(t);
    const preCapture = snapshots.find((s) => s.reason === "PRE_PROMOTE");
    expect(preCapture?.revision).toBe(3); // NOT re-attached to v2 — v2's sent snapshot stays frozen evidence
    expect(autoSaved?.snapshotId).toBe(preCapture?.id);
  });

  test("branch 3: live revision already captured and identical — skipped, no new revision allocated", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t, ORG, { revision: 2, liveRevision: 2 });
    await seedSnapshotAt(t, 1, "VERSION_SAVED");
    // The v2 snapshot's line items match the CURRENT live line items EXACTLY
    // (same fields `seedProject` inserted for "l1") — no drift.
    await seedSnapshotAt(t, 2, "QUOTE_SENT", {
      lineItems: [{
        id: "l1", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT",
        isKitChild: false, isOptional: false, description: "PA System", quantity: 1, unitPrice: 100, lineTotal: 100,
      }],
    });

    const result = await promote(t, 1);
    expect(result.autoSavedRevision).toBeUndefined();

    const project = await getProject(t);
    expect(project?.revision).toBe(2); // no number allocated
    expect(await getQuotes(t)).toHaveLength(0); // no auto-saved draft opened

    const snapshots = await getSnapshots(t);
    expect(snapshots.filter((s) => s.reason === "PRE_PROMOTE")).toHaveLength(0);
  });
});

describe("promoteRevisionNative — PROMOTE restore field set (design §3.5)", () => {
  test("restores dates/name/discount/duration-derived pricing; leaves status/invoicedTotal/derived totals alone", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t, ORG, {
      revision: 2, liveRevision: 2, status: "CONFIRMED", name: "Live Gig",
      rentalStartDate: NOW, rentalEndDate: NOW + 86_400_000, discountPercent: 0,
      billingWeeksOverride: undefined, invoicedTotal: 500, depositPaid: 200,
    });
    await seedSnapshotAt(t, 1, "VERSION_SAVED", {
      project: {
        name: "V1 Gig", status: "ENQUIRY", // must NOT overwrite live's CONFIRMED
        rentalStartDate: NOW - 10 * 86_400_000, rentalEndDate: NOW - 5 * 86_400_000,
        discountPercent: 15, billingWeeksOverride: 3,
        invoicedTotal: 9999, depositPaid: 9999, // poisoned — must NOT be copied
        subtotal: 9999, total: 9999, taxAmount: 9999, margin: 9999, equipmentRevenue: 9999, // derived — recalc-owned
      },
    });

    await promote(t, 1);
    const project = await getProject(t);
    if (!project) throw new Error("project not found");

    // Restored (not excluded):
    expect(project.name).toBe("V1 Gig");
    expect(project.rentalStartDate).toBe(NOW - 10 * 86_400_000);
    expect(project.rentalEndDate).toBe(NOW - 5 * 86_400_000);
    expect(project.discountPercent).toBe(15);
    expect(project.billingWeeksOverride).toBe(3); // duration-derived pricing FROM the snapshot, not recomputed

    // Excluded — untouched or recalc-owned, never the poisoned snapshot value:
    expect(project.status).toBe("CONFIRMED");
    expect(project.invoicedTotal).not.toBe(9999);
    expect(project.invoicedTotal).toBe(0); // recalc-derived from real (nonexistent) invoices, not restored
    expect(project.total).not.toBe(9999);
    expect(project.subtotal).not.toBe(9999);
    expect(project.revision).toBe(2); // the counters themselves are never restored
    expect(project.liveRevision).toBe(1);
  });

  test("round trip v2 -> v1 -> v2 loses no data on the target's own captured fields", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t, ORG, { revision: 3, liveRevision: 3, name: "V3 name", discountPercent: 20 });
    await seedSnapshotAt(t, 1, "VERSION_SAVED", { project: { name: "V1 name", discountPercent: 5 } });
    await seedSnapshotAt(t, 2, "VERSION_SAVED", { project: { name: "V2 name", discountPercent: 10 } });

    await promote(t, 1);
    expect((await getProject(t))?.name).toBe("V1 name");
    expect((await getProject(t))?.liveRevision).toBe(1);

    await promote(t, 2, { now: NOW + 1 });
    expect((await getProject(t))?.name).toBe("V2 name");
    expect((await getProject(t))?.discountPercent).toBe(10);
    expect((await getProject(t))?.liveRevision).toBe(2);
    // revision (the allocator) never decremented across the round trip.
    expect((await getProject(t))?.revision).toBeGreaterThanOrEqual(3);
  });
});

describe("promoteRevisionNative — warehouse conflicts (never forced)", () => {
  test("a promote that both adds and removes asset-backed lines returns both conflicts and mutates neither", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t, ORG, { revision: 2, liveRevision: 2 });
    // Target (v1) snapshot references an asset-backed line NOT present live.
    await seedSnapshotAt(t, 1, "VERSION_SAVED", {
      lineItems: [{ id: "l_missing", organizationId: ORG, projectId: "p1", assetId: "A1", unitPrice: 200, description: "Missing asset line" }],
    });
    // Live state has an asset-backed line NOT present in the target snapshot.
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", {
        id: "l_extra", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT",
        isKitChild: false, isOptional: false, description: "Extra asset line", quantity: 1, unitPrice: 300,
        lineTotal: 300, assetId: "A2",
      });
    });

    const result = await promote(t, 1);
    expect(result.conflicts.some((c) => /added during the session/i.test(c))).toBe(true);
    expect(result.conflicts.some((c) => /removed during the session/i.test(c))).toBe(true);

    const lineItems = await getLineItems(t);
    expect(lineItems.find((li) => li.id === "l_extra")).toBeDefined(); // NOT deleted
    expect(lineItems.find((li) => li.id === "l_missing")).toBeUndefined(); // NOT force-inserted
  });
});

describe("promoteRevisionNative — availability re-derive on a moved rental window (design §5.2)", () => {
  test("moving the window back onto another project's booking surfaces an overbooking conflict", async () => {
    const t = makeT();
    await seedMember(t);
    const oldStart = NOW - 20 * 86_400_000;
    const oldEnd = NOW - 15 * 86_400_000;
    await seedProject(t, ORG, {
      revision: 2, liveRevision: 2, status: "CONFIRMED",
      rentalStartDate: NOW, rentalEndDate: NOW + 5 * 86_400_000,
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("models", { id: "mdl", organizationId: ORG, name: "IMX6A", assetType: "SERIALIZED" });
      await ctx.db.insert("assets", { id: "A0", organizationId: ORG, modelId: "mdl", assetTag: "A-0", status: "AVAILABLE" });
      // This project's own line references the model, so the shortage is "its" problem.
      await ctx.db.insert("projectLineItems", {
        id: "l_gear", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT",
        isKitChild: false, isOptional: false, description: "Camera", quantity: 1, unitPrice: 10, lineTotal: 10, modelId: "mdl",
      });
      // Another CONFIRMED project books the same single-stock model over the OLD window.
      await ctx.db.insert("projects", {
        id: "p_other", organizationId: ORG, projectNumber: "OTHER-1", name: "Other job", status: "CONFIRMED",
        isTemplate: false, rentalStartDate: oldStart, rentalEndDate: oldEnd, createdAt: NOW, updatedAt: NOW,
      });
      await ctx.db.insert("projectLineItems", {
        id: "l_other", organizationId: ORG, projectId: "p_other", status: "CONFIRMED", type: "EQUIPMENT",
        isKitChild: false, isOptional: false, description: "Camera", quantity: 1, unitPrice: 10, lineTotal: 10, modelId: "mdl",
      });
    });
    // Promoting to v1 moves the rental window BACK onto the other project's booking.
    await seedSnapshotAt(t, 1, "VERSION_SAVED", {
      project: { rentalStartDate: oldStart, rentalEndDate: oldEnd },
      lineItems: [{ id: "l_gear", organizationId: ORG, projectId: "p1", modelId: "mdl", unitPrice: 10, quantity: 1 }],
    });

    const result = await promote(t, 1);
    expect(result.conflicts.some((c) => /shortage/i.test(c) && /imx6a/i.test(c))).toBe(true);

    const project = await getProject(t);
    expect(project?.rentalStartDate).toBe(oldStart);
    expect(project?.rentalEndDate).toBe(oldEnd);
  });

  test("a promote that doesn't move the window reports no overbooking conflicts", async () => {
    const t = makeT();
    await seedMember(t);
    await seedProject(t, ORG, { revision: 2, liveRevision: 2, rentalStartDate: NOW, rentalEndDate: NOW + 5 * 86_400_000 });
    await seedSnapshotAt(t, 1, "VERSION_SAVED", { project: { rentalStartDate: NOW, rentalEndDate: NOW + 5 * 86_400_000 } });

    const result = await promote(t, 1);
    expect(result.conflicts).toEqual([]);
  });
});
