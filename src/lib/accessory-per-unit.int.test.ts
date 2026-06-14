/**
 * Per-parent-unit accessory prep/return (FEATUREDOCS/48). Exercises the
 * primitives directly against the Postgres test DB (no Convex mirror): prepping
 * each parent unit (handheld) materialises ITS OWN accessory unit, marked
 * PACKED, tied via parentUnitAssetId — so "prep 3 handhelds × 2 AA" packs three
 * battery sets, not just the first. Returning one handheld returns only its
 * accessory; siblings stay out. Covers multiple accessories on one item too.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  testPrisma, setupIntegrationTest, createOrgFixture, createUserFixture,
  createModelFixture, createAssetFixture, createBulkAssetFixture,
} from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";
import { prepUnit, checkinAccessoryChildren } from "@/lib/line-item-fulfillment";

async function seedHandheldLine(orgId: string, userId: string, qty: number) {
  const handheldModel = await createModelFixture(orgId, { name: "Handheld" });
  const project = await testPrisma.project.create({
    data: { organizationId: orgId, projectNumber: `P-${createId().slice(0, 8)}`, name: "T", taxRate: 0 },
  });
  const line = await testPrisma.projectLineItem.create({
    data: { organizationId: orgId, projectId: project.id, modelId: handheldModel.id, quantity: qty, status: "CONFIRMED" },
  });
  return { handheldModel, project, line };
}

describe("per-parent-unit accessory prep + return", () => {
  beforeEach(async () => { await setupIntegrationTest(); });
  afterAll(async () => { await testPrisma.$disconnect(); });

  it("prepping each handheld materialises its OWN battery unit (PACKED), not just the first", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const { project, line } = await seedHandheldLine(org.id, user.id, 3);

    const aaModel = await createModelFixture(org.id, { name: "AA Battery" });
    const aa = await createBulkAssetFixture(org.id, aaModel.id, { assetTag: "AA-POOL", total: 100 });
    const handhelds: { id: string }[] = [];
    for (let i = 0; i < 3; i++) {
      const h = await createAssetFixture(org.id, aaModel.id, { assetTag: `HH-${i}-${createId().slice(0, 4)}` });
      await testPrisma.assetBulkChild.create({
        data: { organizationId: org.id, parentAssetId: h.id, bulkAssetId: aa.id, quantity: 1, addedById: user.id },
      });
      handhelds.push(h);
    }

    // Prep all three handhelds.
    for (const h of handhelds) {
      await testPrisma.$transaction((tx) =>
        prepUnit(tx, { organizationId: org.id, lineItemId: line.id, assetId: h.id, bulkAssetId: null }));
    }

    const accLine = await testPrisma.projectLineItem.findFirstOrThrow({
      where: { parentLineItemId: line.id, childKind: "ACCESSORY", bulkAssetId: aa.id },
    });
    const accUnits = await testPrisma.projectLineItemUnit.findMany({
      where: { lineItemId: accLine.id },
      orderBy: { ordinal: "asc" },
    });

    // Three battery units, one per handheld, every one PACKED.
    expect(accUnits).toHaveLength(3);
    expect(accUnits.every((u) => u.prepStatus === "PACKED")).toBe(true);
    expect(new Set(accUnits.map((u) => u.parentUnitAssetId))).toEqual(
      new Set(handhelds.map((h) => h.id)),
    );
    expect(accUnits.every((u) => u.bulkAssetId === aa.id)).toBe(true);
  });

  it("handles multiple accessories on one item (battery + serialised mic clip)", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const { project, line } = await seedHandheldLine(org.id, user.id, 1);

    const aaModel = await createModelFixture(org.id, { name: "AA Battery" });
    const clipModel = await createModelFixture(org.id, { name: "Mic Clip" });
    const aa = await createBulkAssetFixture(org.id, aaModel.id, { assetTag: "AA2", total: 50 });
    const handheld = await createAssetFixture(org.id, aaModel.id, { assetTag: `HH-${createId().slice(0, 4)}` });
    // Bulk accessory: battery kit.
    await testPrisma.assetBulkChild.create({
      data: { organizationId: org.id, parentAssetId: handheld.id, bulkAssetId: aa.id, quantity: 2, addedById: user.id },
    });
    // Serialised accessory: a mic clip asset whose parent is the handheld.
    const clip = await createAssetFixture(org.id, clipModel.id, { assetTag: `CLIP-${createId().slice(0, 4)}` });
    await testPrisma.asset.update({ where: { id: clip.id }, data: { parentAssetId: handheld.id } });

    await testPrisma.$transaction((tx) =>
      prepUnit(tx, { organizationId: org.id, lineItemId: line.id, assetId: handheld.id, bulkAssetId: null }));

    const accUnits = await testPrisma.projectLineItemUnit.findMany({
      where: { lineItem: { parentLineItemId: line.id, childKind: "ACCESSORY" } },
    });
    // Two accessory units under the one handheld: the battery + the clip.
    expect(accUnits).toHaveLength(2);
    expect(accUnits.every((u) => u.parentUnitAssetId === handheld.id)).toBe(true);
    expect(accUnits.every((u) => u.prepStatus === "PACKED")).toBe(true);
    expect(accUnits.find((u) => u.assetId === clip.id)).toBeTruthy();   // serialised clip unit
    expect(accUnits.find((u) => u.bulkAssetId === aa.id)?.quantity).toBe(2); // battery qty
  });

  it("excluding an accessory at prep leaves no unit for it on that handheld", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const { line } = await seedHandheldLine(org.id, user.id, 1);

    const aaModel = await createModelFixture(org.id, { name: "AA Battery" });
    const clipModel = await createModelFixture(org.id, { name: "Mic Clip" });
    const aa = await createBulkAssetFixture(org.id, aaModel.id, { assetTag: "AAX", total: 50 });
    const handheld = await createAssetFixture(org.id, aaModel.id, { assetTag: `HHX-${createId().slice(0, 4)}` });
    await testPrisma.assetBulkChild.create({
      data: { organizationId: org.id, parentAssetId: handheld.id, bulkAssetId: aa.id, quantity: 2, addedById: user.id },
    });
    const clip = await createAssetFixture(org.id, clipModel.id, { assetTag: `CLIPX-${createId().slice(0, 4)}` });
    await testPrisma.asset.update({ where: { id: clip.id }, data: { parentAssetId: handheld.id } });

    // Prep, but include ONLY the clip — leave the battery off this handheld.
    await testPrisma.$transaction((tx) =>
      prepUnit(tx, {
        organizationId: org.id,
        lineItemId: line.id,
        assetId: handheld.id,
        bulkAssetId: null,
        includeAccessoryIds: new Set([clip.id]),
      }));

    const accUnits = await testPrisma.projectLineItemUnit.findMany({
      where: { lineItem: { parentLineItemId: line.id, childKind: "ACCESSORY" } },
    });
    // Only the clip got a unit; the battery was excluded.
    expect(accUnits).toHaveLength(1);
    expect(accUnits[0].assetId).toBe(clip.id);
    expect(accUnits.some((u) => u.bulkAssetId === aa.id)).toBe(false);
  });

  it("returning one handheld returns only ITS accessory; siblings stay out", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const { project, line } = await seedHandheldLine(org.id, user.id, 3);

    const aaModel = await createModelFixture(org.id, { name: "AA Battery" });
    const aa = await createBulkAssetFixture(org.id, aaModel.id, { assetTag: "AA3", total: 100 });
    const handhelds: { id: string }[] = [];
    for (let i = 0; i < 3; i++) {
      const h = await createAssetFixture(org.id, aaModel.id, { assetTag: `HH3-${i}-${createId().slice(0, 4)}`, status: "CHECKED_OUT" });
      await testPrisma.assetBulkChild.create({
        data: { organizationId: org.id, parentAssetId: h.id, bulkAssetId: aa.id, quantity: 1, addedById: user.id },
      });
      await testPrisma.$transaction((tx) =>
        prepUnit(tx, { organizationId: org.id, lineItemId: line.id, assetId: h.id, bulkAssetId: null }));
      handhelds.push(h);
    }
    const accLine = await testPrisma.projectLineItem.findFirstOrThrow({
      where: { parentLineItemId: line.id, childKind: "ACCESSORY", bulkAssetId: aa.id },
    });
    // Simulate deployed: flip the three accessory units CHECKED_OUT.
    await testPrisma.projectLineItemUnit.updateMany({
      where: { lineItemId: accLine.id }, data: { status: "CHECKED_OUT" },
    });

    // Return ONLY handheld 0.
    await testPrisma.$transaction((tx) =>
      checkinAccessoryChildren(tx, {
        organizationId: org.id,
        projectId: project.id,
        parentLineItemId: line.id,
        returnCondition: "GOOD",
        userId: user.id,
        defaultLocationId: null,
        returnedAssetId: handhelds[0].id,
      }));

    const units = await testPrisma.projectLineItemUnit.findMany({
      where: { lineItemId: accLine.id },
    });
    const returned = units.filter((u) => u.status === "RETURNED");
    const stillOut = units.filter((u) => u.status === "CHECKED_OUT");
    expect(returned).toHaveLength(1);
    expect(returned[0].parentUnitAssetId).toBe(handhelds[0].id);
    expect(stillOut).toHaveLength(2);
  });
});
