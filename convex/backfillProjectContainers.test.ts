// @vitest-environment node
//
// Packing containers (#1296) — build plan phase 1d backfill. Verifies a
// pre-#1296 container line (isContainerLineItem, no projectContainers row)
// gets one paired via reuse; a content unit carrying only a label gets a
// containerId; an orphaned custom label with no dedicated container line
// mints a fresh CUSTOM one; two units sharing the same label converge on
// ONE container; and a repeat run is a no-op (idempotent).
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const NOW = 1_700_000_000_000;
const SERVICE = { subject: "gearflow-service", svc: true };
const V1 = "v-p1";
const makeT = () => convexTest(schema, modules);
type T = ReturnType<typeof makeT>;

async function seedProject(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P-1", name: "Test", total: 0, liveVersionId: V1, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("projectVersions", { id: V1, organizationId: ORG, projectId: "p1", number: 1, contentState: "ready", createdAt: NOW, createdById: "u1" });
  });
}

async function runUnitsStage(t: T, apply = true) {
  let cursor: string | null = null;
  let scanned = 0;
  let backfilled = 0;
  for (;;) {
    const r: { scanned: number; backfilled: number; isDone: boolean; continueCursor: string } =
      await t.withIdentity(SERVICE).mutation(api.backfillProjectContainers.backfillProjectContainersUnitsPage, { cursor, apply });
    scanned += r.scanned; backfilled += r.backfilled;
    if (r.isDone) break;
    cursor = r.continueCursor;
  }
  return { scanned, backfilled };
}

async function runLinesStage(t: T, apply = true) {
  let cursor: string | null = null;
  let scanned = 0;
  let backfilled = 0;
  for (;;) {
    const r: { scanned: number; backfilled: number; isDone: boolean; continueCursor: string } =
      await t.withIdentity(SERVICE).mutation(api.backfillProjectContainers.backfillProjectContainersLinesPage, { cursor, apply });
    scanned += r.scanned; backfilled += r.backfilled;
    if (r.isDone) break;
    cursor = r.continueCursor;
  }
  return { scanned, backfilled };
}

const unitById = (t: T, id: string) => t.run((ctx) => ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const lineById = (t: T, id: string) => t.run((ctx) => ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).first());
const containersInVersion = (t: T) => t.run((ctx) => ctx.db.query("projectContainers").withIndex("by_versionId", (q) => q.eq("versionId", V1)).collect());

describe("backfillProjectContainers", () => {
  test("a serialised unit's label resolves to (and reuses) the pre-existing container line", async () => {
    const t = makeT();
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", {
        id: "case-li", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "case-li",
        type: "EQUIPMENT", assetId: "case-asset", quantity: 1, sortOrder: 0, status: "CONFIRMED",
        prepStatus: "PACKED", prepContainer: "Case 12", isContainerLineItem: true, createdAt: NOW, updatedAt: NOW,
      });
      await ctx.db.insert("projectLineItems", {
        id: "content-li", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "content-li",
        type: "EQUIPMENT", quantity: 1, sortOrder: 1, status: "CONFIRMED", createdAt: NOW, updatedAt: NOW,
      });
      await ctx.db.insert("projectLineItemUnits", {
        id: "u1", organizationId: ORG, lineItemId: "content-li", ordinal: 0, assetId: "a1",
        status: "CONFIRMED", returnedQuantity: 0, prepContainer: "Case 12", createdAt: NOW, updatedAt: NOW,
      });
    });

    const { scanned, backfilled } = await runUnitsStage(t);
    expect(scanned).toBe(1);
    expect(backfilled).toBe(1);

    const containers = await containersInVersion(t);
    expect(containers).toHaveLength(1);
    expect(containers[0].kind).toBe("ASSET"); // reused the existing (non-custom) line
    expect(containers[0].lineItemId).toBe("case-li");

    expect((await unitById(t, "u1"))?.containerId).toBe(containers[0].id);
    expect((await lineById(t, "case-li"))?.containerId).toBe(containers[0].id); // reverse lookup stamped

    // Idempotent re-run: no duplicate container, nothing re-scanned.
    const second = await runUnitsStage(t);
    expect(second.scanned).toBe(0);
    expect(await containersInVersion(t)).toHaveLength(1);
  });

  test("two units sharing a label with no dedicated container line converge on ONE fresh CUSTOM container", async () => {
    const t = makeT();
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li-a", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "li-a", type: "EQUIPMENT", quantity: 1, sortOrder: 0, status: "CONFIRMED", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItems", { id: "li-b", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "li-b", type: "EQUIPMENT", quantity: 1, sortOrder: 1, status: "CONFIRMED", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItemUnits", { id: "u-a", organizationId: ORG, lineItemId: "li-a", ordinal: 0, assetId: "a1", status: "CONFIRMED", returnedQuantity: 0, prepContainer: "Tub 3", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItemUnits", { id: "u-b", organizationId: ORG, lineItemId: "li-b", ordinal: 0, assetId: "a2", status: "CONFIRMED", returnedQuantity: 0, prepContainer: "Tub 3", createdAt: NOW, updatedAt: NOW });
    });

    await runUnitsStage(t);
    const containers = await containersInVersion(t);
    expect(containers).toHaveLength(1);
    expect(containers[0].kind).toBe("CUSTOM");
    expect((await unitById(t, "u-a"))?.containerId).toBe(containers[0].id);
    expect((await unitById(t, "u-b"))?.containerId).toBe(containers[0].id);
  });

  test("lines stage catches a container line with no content unit at all", async () => {
    const t = makeT();
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", {
        id: "empty-case-li", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "empty-case-li",
        type: "EQUIPMENT", assetId: "case-asset", quantity: 1, sortOrder: 0, status: "CONFIRMED",
        prepStatus: "PACKED", prepContainer: "Empty Case", isContainerLineItem: true, createdAt: NOW, updatedAt: NOW,
      });
    });

    const unitsResult = await runUnitsStage(t);
    expect(unitsResult.scanned).toBe(0); // no unit references it — units stage has nothing to do
    expect(await containersInVersion(t)).toHaveLength(0);

    const linesResult = await runLinesStage(t);
    expect(linesResult.scanned).toBe(1);
    expect(linesResult.backfilled).toBe(1);
    const containers = await containersInVersion(t);
    expect(containers).toHaveLength(1);
    expect(containers[0].lineItemId).toBe("empty-case-li");
    expect((await lineById(t, "empty-case-li"))?.containerId).toBe(containers[0].id);
  });

  test("dry run (apply: false) counts but writes nothing", async () => {
    const t = makeT();
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li-a", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "li-a", type: "EQUIPMENT", quantity: 1, sortOrder: 0, status: "CONFIRMED", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItemUnits", { id: "u-a", organizationId: ORG, lineItemId: "li-a", ordinal: 0, assetId: "a1", status: "CONFIRMED", returnedQuantity: 0, prepContainer: "Tub 3", createdAt: NOW, updatedAt: NOW });
    });

    const { scanned, backfilled } = await runUnitsStage(t, false);
    expect(scanned).toBe(1);
    expect(backfilled).toBe(0);
    expect(await containersInVersion(t)).toHaveLength(0);
    expect((await unitById(t, "u-a"))?.containerId).toBeUndefined();
  });

  test("a unit with no prepContainer, or already backfilled, is left alone", async () => {
    const t = makeT();
    await seedProject(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("projectLineItems", { id: "li-a", organizationId: ORG, projectId: "p1", versionId: V1, lineageId: "li-a", type: "EQUIPMENT", quantity: 1, sortOrder: 0, status: "CONFIRMED", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItemUnits", { id: "u-loose", organizationId: ORG, lineItemId: "li-a", ordinal: 0, assetId: "a1", status: "CONFIRMED", returnedQuantity: 0, createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("projectLineItemUnits", { id: "u-native", organizationId: ORG, lineItemId: "li-a", ordinal: 1, assetId: "a2", status: "CONFIRMED", returnedQuantity: 0, containerId: "already-c1", createdAt: NOW, updatedAt: NOW });
    });

    const { scanned } = await runUnitsStage(t);
    expect(scanned).toBe(0);
    expect(await containersInVersion(t)).toHaveLength(0);
  });
});
