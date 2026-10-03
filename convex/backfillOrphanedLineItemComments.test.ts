// @vitest-environment node
//
// One-time cleanup for comment threads / review markers orphaned by a line item
// deleted before deleteCommentsAndMarkersForTarget was wired into the delete
// paths (see convex/lineItemWrites.ts). Dry-run by default, idempotent, and
// leaves non-lineItem-targeted / still-live-targeted rows untouched.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const makeT = () => convexTest(schema, modules);
type T = ReturnType<typeof makeT>;

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projectLineItems", { id: "live-li", organizationId: ORG, projectId: "p1", status: "CONFIRMED", type: "EQUIPMENT" });

    // Orphaned thread (+ its comment) — target line item no longer exists.
    const orphanThread = await ctx.db.insert("commentThreads", {
      orgId: ORG, entityType: "project", entityId: "p1", targetType: "lineItem", targetId: "deleted-li",
      status: "open", isBlocking: true, createdBy: "u1", createdByName: "Alice", createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("comments", { orgId: ORG, threadId: orphanThread as unknown as string, body: "blocked", authorId: "u1", authorName: "Alice", authorColor: "#000", createdAt: NOW });

    // Live thread — target line item still exists.
    await ctx.db.insert("commentThreads", {
      orgId: ORG, entityType: "project", entityId: "p1", targetType: "lineItem", targetId: "live-li",
      status: "open", isBlocking: true, createdBy: "u1", createdByName: "Alice", createdAt: NOW, updatedAt: NOW,
    });

    // A project-level thread (no lineItem target) — must never be touched.
    await ctx.db.insert("commentThreads", {
      orgId: ORG, entityType: "project", entityId: "p1",
      status: "open", isBlocking: true, createdBy: "u1", createdByName: "Alice", createdAt: NOW, updatedAt: NOW,
    });

    // Orphaned marker with NO thread of its own.
    await ctx.db.insert("reviewMarkers", {
      orgId: ORG, entityType: "project", entityId: "p1", targetType: "lineItem", targetId: "deleted-li-2",
      status: "needs_review", createdBy: "u1", createdByName: "Alice", createdAt: NOW, updatedAt: NOW,
    });
  });
}

async function runPages(t: T, fnName: "backfillOrphanedCommentThreadsPage" | "backfillOrphanedReviewMarkersPage", apply: boolean) {
  let cursor: string | null = null;
  let scanned = 0;
  let orphaned = 0;
  for (;;) {
    const r: { scanned: number; orphaned: number; isDone: boolean; continueCursor: string } =
      await t.withIdentity(SERVICE).mutation(api.backfillOrphanedLineItemComments[fnName], { cursor, apply });
    scanned += r.scanned;
    orphaned += r.orphaned;
    if (r.isDone) break;
    cursor = r.continueCursor;
  }
  return { scanned, orphaned };
}

describe("backfillOrphanedLineItemComments", () => {
  test("dry run counts orphans without deleting anything", async () => {
    const t = makeT();
    await seed(t);
    const threads = await runPages(t, "backfillOrphanedCommentThreadsPage", false);
    expect(threads.orphaned).toBe(1);
    const markers = await runPages(t, "backfillOrphanedReviewMarkersPage", false);
    expect(markers.orphaned).toBe(1);
    await t.run(async (ctx) => {
      const all = await ctx.db.query("commentThreads").collect();
      expect(all).toHaveLength(3); // nothing deleted
    });
  });

  test("apply deletes orphaned threads (+ comments) and markers, leaves live/non-lineItem rows", async () => {
    const t = makeT();
    await seed(t);
    await runPages(t, "backfillOrphanedCommentThreadsPage", true);
    await runPages(t, "backfillOrphanedReviewMarkersPage", true);

    await t.run(async (ctx) => {
      const threads = await ctx.db.query("commentThreads").collect();
      expect(threads).toHaveLength(2); // orphan gone; live + project-level survive
      expect(threads.some((th) => th.targetId === "deleted-li")).toBe(false);
      expect(threads.some((th) => th.targetId === "live-li")).toBe(true);
      expect(threads.some((th) => th.targetType === undefined)).toBe(true);

      const comments = await ctx.db.query("comments").collect();
      expect(comments).toHaveLength(0); // the orphan's comment went with it

      const markers = await ctx.db.query("reviewMarkers").collect();
      expect(markers).toHaveLength(0);
    });

    // Re-run is a no-op (idempotent).
    const threads2 = await runPages(t, "backfillOrphanedCommentThreadsPage", true);
    expect(threads2.orphaned).toBe(0);
    const markers2 = await runPages(t, "backfillOrphanedReviewMarkersPage", true);
    expect(markers2.orphaned).toBe(0);
  });

  test("verify queries mirror the page mutations' counts", async () => {
    const t = makeT();
    await seed(t);
    const verifyAll = async (op: "verifyOrphanedCommentThreads" | "verifyOrphanedReviewMarkers") => {
      let cursor: string | null = null;
      let total = 0;
      for (;;) {
        const r: { orphaned: number; isDone: boolean; continueCursor: string } =
          await t.withIdentity(SERVICE).query(api.backfillOrphanedLineItemComments[op], { cursor });
        total += r.orphaned;
        if (r.isDone) break;
        cursor = r.continueCursor;
      }
      return total;
    };
    expect(await verifyAll("verifyOrphanedCommentThreads")).toBe(1);
    expect(await verifyAll("verifyOrphanedReviewMarkers")).toBe(1);
  });

  test("rejects a non-service caller", async () => {
    const t = makeT();
    await expect(
      t.mutation(api.backfillOrphanedLineItemComments.backfillOrphanedCommentThreadsPage, { cursor: null, apply: false }),
    ).rejects.toThrow();
  });
});
