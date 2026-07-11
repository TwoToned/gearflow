/**
 * Integration tests for how custom items in a group contribute to project revenue.
 *
 * The rule (revenue-allocation change):
 *   - A PRICED group's flat price is the whole total for everything inside it, so a
 *     custom item is PART of that price and is NOT added on top.
 *   - An UNPRICED group (used purely as an organiser) has no flat price to be part
 *     of, so its custom items still bill on their own — otherwise they'd vanish from
 *     the invoice.
 *
 *   groupRevenue = (group.price × group.quantity)
 *                + (group.price > 0 ? 0 : Σ custom items' lineTotal in group)
 *
 * calculateSuggestedPrice is unchanged: equipment-only, never custom items.
 *
 * These tests verify the formula with real Prisma queries. (History: the earlier
 * "Wave 2 fix" made custom-in-group bill on top unconditionally; that inflated ROI
 * for the gear beside a big custom line and double-counted against a flat price, so
 * the flat-price case now treats the custom as inside the bundle.)
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
  createModelFixture,
} from "../../tests/helpers/integration";
import { createId } from "@paralleldrive/cuid2";
import { calculateSuggestedPrice } from "./project-groups";

async function createProjectFixture(orgId: string) {
  return testPrisma.project.create({
    data: {
      organizationId: orgId,
      projectNumber: `P-${createId().slice(0, 8)}`,
      name: "Test Project",
      taxRate: 0, // disable tax so totals are predictable
    },
  });
}

async function createProjectGroupFixture(
  orgId: string,
  projectId: string,
  options: { price: number; quantity?: number },
) {
  // ProjectGroup requires a category — create one inline
  const category = await testPrisma.projectCategory.create({
    data: {
      organizationId: orgId,
      projectId,
      name: "Test Category",
    },
  });
  return testPrisma.projectGroup.create({
    data: {
      organizationId: orgId,
      projectId,
      categoryId: category.id,
      title: "Test Group",
      price: options.price,
      quantity: options.quantity ?? 1,
    },
  });
}

async function createCustomLineItem(
  orgId: string,
  projectId: string,
  options: {
    lineTotal: number;
    groupId?: string | null;
    isOptional?: boolean;
    status?: "QUOTED" | "CONFIRMED" | "CANCELLED";
    quantity?: number;
  },
) {
  return testPrisma.projectLineItem.create({
    data: {
      organizationId: orgId,
      projectId,
      type: "EQUIPMENT",
      isCustomItem: true,
      description: "Custom test item",
      quantity: options.quantity ?? 1,
      unitPrice: options.lineTotal, // simplification — lineTotal carries through
      duration: 1,
      pricingType: "FLAT",
      lineTotal: options.lineTotal,
      isOptional: options.isOptional ?? false,
      isKitChild: false,
      groupId: options.groupId ?? null,
      status: options.status ?? "QUOTED",
    },
  });
}

/**
 * Replicates the groupRevenue calculation from recalculateProjectTotals.
 * Exact mirror of the production query so the invariant is verifiable.
 */
async function calculateGroupRevenue(projectId: string): Promise<number> {
  const groups = await testPrisma.projectGroup.findMany({
    where: { projectId },
    select: {
      price: true,
      quantity: true,
      lineItems: {
        where: {
          isCustomItem: true,
          isOptional: false,
          isKitChild: false,
          status: { not: "CANCELLED" },
        },
        select: { lineTotal: true },
      },
    },
  });

  return groups.reduce((sum, g) => {
    const bundlePrice = g.price != null ? Number(g.price) : 0;
    // A priced group covers its customs inside the flat price; only an unpriced
    // group bills them on their own. Mirror of convex/lib/recalc.ts.
    const customExtras =
      bundlePrice > 0
        ? 0
        : g.lineItems.reduce(
            (s, li) => s + (li.lineTotal != null ? Number(li.lineTotal) : 0),
            0,
          );
    return sum + bundlePrice * g.quantity + customExtras;
  }, 0);
}

/** Replicates the standalone-items calculation from recalculateProjectTotals. */
async function calculateStandaloneRevenue(projectId: string): Promise<number> {
  const items = await testPrisma.projectLineItem.findMany({
    where: {
      projectId,
      groupId: null,
      isOptional: false,
      isKitChild: false,
      status: { not: "CANCELLED" },
    },
    select: { lineTotal: true },
  });
  return items.reduce(
    (sum, li) => sum + (li.lineTotal != null ? Number(li.lineTotal) : 0),
    0,
  );
}

describe("group revenue with custom items (Wave 2 fix)", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("a custom item in a PRICED group is inside the price, not added on top", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    await createModelFixture(org.id);
    const project = await createProjectFixture(org.id);
    const group = await createProjectGroupFixture(org.id, project.id, {
      price: 500,
      quantity: 1,
    });

    // The $500 flat price already covers this custom item — it is NOT $600.
    await createCustomLineItem(org.id, project.id, {
      lineTotal: 100,
      groupId: group.id,
    });

    const groupRevenue = await calculateGroupRevenue(project.id);
    expect(groupRevenue).toBe(500); // flat price only
  });

  it("multiple custom items in a PRICED group are all covered by the flat price", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const project = await createProjectFixture(org.id);
    const group = await createProjectGroupFixture(org.id, project.id, {
      price: 200,
    });

    await createCustomLineItem(org.id, project.id, {
      lineTotal: 50,
      groupId: group.id,
    });
    await createCustomLineItem(org.id, project.id, {
      lineTotal: 75,
      groupId: group.id,
    });

    const groupRevenue = await calculateGroupRevenue(project.id);
    expect(groupRevenue).toBe(200); // flat price only; the customs sit inside it
  });

  it("custom items in an UNPRICED group still bill on their own", async () => {
    // A group with no flat price is just an organiser — its customs must still show.
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const project = await createProjectFixture(org.id);
    const group = await createProjectGroupFixture(org.id, project.id, {
      price: 0,
    });

    await createCustomLineItem(org.id, project.id, {
      lineTotal: 50,
      groupId: group.id,
    });
    await createCustomLineItem(org.id, project.id, {
      lineTotal: 75,
      groupId: group.id,
    });

    const groupRevenue = await calculateGroupRevenue(project.id);
    expect(groupRevenue).toBe(125); // 0 bundle + 50 + 75
  });

  it("in an unpriced group, optional custom items still do NOT contribute", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const project = await createProjectFixture(org.id);
    const group = await createProjectGroupFixture(org.id, project.id, {
      price: 0,
    });

    await createCustomLineItem(org.id, project.id, {
      lineTotal: 100,
      groupId: group.id,
    });
    await createCustomLineItem(org.id, project.id, {
      lineTotal: 999,
      groupId: group.id,
      isOptional: true, // excluded
    });

    const groupRevenue = await calculateGroupRevenue(project.id);
    expect(groupRevenue).toBe(100); // 100, not 100 + 999
  });

  it("in an unpriced group, CANCELLED custom items still do NOT contribute", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const project = await createProjectFixture(org.id);
    const group = await createProjectGroupFixture(org.id, project.id, {
      price: 0,
    });

    await createCustomLineItem(org.id, project.id, {
      lineTotal: 50,
      groupId: group.id,
    });
    await createCustomLineItem(org.id, project.id, {
      lineTotal: 200,
      groupId: group.id,
      status: "CANCELLED",
    });

    const groupRevenue = await calculateGroupRevenue(project.id);
    expect(groupRevenue).toBe(50); // the cancelled $200 is excluded
  });

  it("standalone (ungrouped) custom items contribute via the standalone query", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const project = await createProjectFixture(org.id);

    // No group at all
    await createCustomLineItem(org.id, project.id, {
      lineTotal: 250,
      groupId: null,
    });

    const groupRevenue = await calculateGroupRevenue(project.id);
    const standaloneRevenue = await calculateStandaloneRevenue(project.id);
    expect(groupRevenue).toBe(0); // no groups
    expect(standaloneRevenue).toBe(250); // standalone path picks it up
  });

  it("a priced group's total is price × quantity, with customs inside it", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const project = await createProjectFixture(org.id);
    const group = await createProjectGroupFixture(org.id, project.id, {
      price: 100,
      quantity: 3,
    });

    await createCustomLineItem(org.id, project.id, {
      lineTotal: 50,
      groupId: group.id,
    });

    const groupRevenue = await calculateGroupRevenue(project.id);
    expect(groupRevenue).toBe(300); // (100 × 3); the custom is covered by the price
  });

  it("regression: calculateSuggestedPrice excludes custom items (no double-count on Accept Suggested)", async () => {
    // Accept-suggested-price flow copies calculateSuggestedPrice() into
    // ProjectGroup.price. recalculateProjectTotals then adds customExtras
    // on top. If calculateSuggestedPrice ALSO included custom items,
    // every custom item would get billed twice.
    //
    // The fix: calculateSuggestedPrice is equipment-only; custom items
    // are always extras handled by recalculateProjectTotals.
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await testPrisma.model.create({
      data: {
        organizationId: org.id,
        name: "Rate-Bearing Model",
        dailyRate: 100,
      },
    });
    const project = await createProjectFixture(org.id);

    const group = await createProjectGroupFixture(org.id, project.id, {
      price: 0,
      quantity: 1,
    });

    // One real equipment line (1× $100/day) and one custom $999 item
    await testPrisma.projectLineItem.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        type: "EQUIPMENT",
        modelId: model.id,
        groupId: group.id,
        quantity: 1,
        unitPrice: 100,
        duration: 1,
        pricingType: "PER_DAY",
        lineTotal: 100,
        status: "QUOTED",
      },
    });
    await createCustomLineItem(org.id, project.id, {
      lineTotal: 999,
      groupId: group.id,
    });

    const suggested = await calculateSuggestedPrice(group.id);
    expect(suggested).toBe(100); // equipment only, NOT 100 + 999
  });

  it("regression: kit-child custom items do NOT double-count", async () => {
    // The query filters isKitChild: false. Even if a custom-flagged item somehow had
    // isKitChild=true (data corruption scenario), it shouldn't appear in group
    // revenue. Uses an UNPRICED group so a normal custom WOULD contribute — that
    // isolates the kit-child filter rather than the priced-group exclusion.
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const project = await createProjectFixture(org.id);
    const group = await createProjectGroupFixture(org.id, project.id, {
      price: 0,
    });

    // A normal custom that DOES contribute.
    await createCustomLineItem(org.id, project.id, {
      lineTotal: 75,
      groupId: group.id,
    });
    // A kit-child custom that must be filtered out.
    await testPrisma.projectLineItem.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        type: "EQUIPMENT",
        isCustomItem: true,
        description: "Custom kit child",
        quantity: 1,
        unitPrice: 200,
        duration: 1,
        pricingType: "FLAT",
        lineTotal: 200,
        isOptional: false,
        isKitChild: true, // would normally not be both — defensive check
        groupId: group.id,
        status: "QUOTED",
      },
    });

    const groupRevenue = await calculateGroupRevenue(project.id);
    expect(groupRevenue).toBe(75); // only the normal custom; kit-child filtered out
  });
});
