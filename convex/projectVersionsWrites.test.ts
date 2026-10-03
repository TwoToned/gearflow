// @vitest-environment node
//
// convex/projectVersionsWrites.ts — Phase 1 of the project-version-switching
// program (#1080/#1085). #1229 Phase 3 DELETED this file's own
// `saveVersionNative`/`promoteRevisionNative` mutations (superseded by
// `convex/versions.ts`'s `createNative`/`makeLiveNative` on the real
// `projectVersions` table — see `convex/versions.test.ts`) — what remains
// here is `quotesWrites.newVersionNative`'s own "capture the revision it
// moves past" step, which this file already covered and which Phase 3 left
// untouched.
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
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
  // #1228 — every project needs a live projectVersions row + liveVersionId,
  // or every by_versionId-family read/write on it throws.
  const versionId = "v1";
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", {
      id: "p1", organizationId: orgId, projectNumber: "RVLT-2026-0087", name: "Gig",
      status: "QUOTING", isTemplate: false, revision: 1, liveVersionId: versionId,
      subtotal: 100, discountAmount: 0, taxAmount: 10, total: 110, taxRate: 10,
      createdAt: NOW, updatedAt: NOW,
      ...over,
    });
    await ctx.db.insert("projectVersions", {
      id: versionId, organizationId: orgId, projectId: "p1", number: 1,
      contentState: "ready", createdAt: NOW, createdById: "u1",
    });
    await ctx.db.insert("projectLineItems", {
      id: "l1", organizationId: orgId, projectId: "p1", versionId, lineageId: "l1", status: "CONFIRMED", type: "EQUIPMENT",
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

const sendArgs = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "q1", organizationId: ORG, projectId: "p1", quoteDate: NOW, actor, auditId: "a1", now: NOW, ...over,
});
const send = (t: ReturnType<typeof makeT>, over: Partial<Record<string, unknown>> = {}) =>
  t.withIdentity(asUser(ORG)).mutation(api.quotesWrites.sendNative, sendArgs(over) as never);

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
