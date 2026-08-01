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
