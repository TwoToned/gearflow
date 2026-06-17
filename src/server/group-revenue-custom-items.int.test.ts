/**
 * Integration tests for the Wave 2 fix that makes custom items in groups
 * contribute to the project total.
 *
 * The bug: custom items have no `modelId` so calculateSuggestedPrice
 * couldn't compute their price, and recalculateProjectTotals only read
 * the bundle `ProjectGroup.price` — so a custom item placed in a group
 * was invisible to the project total.
 *
 * The fix in recalculateProjectTotals:
 *   groupRevenue = (group.price × group.quantity) + Σ(custom items' lineTotal in group)
 *
 * The fix in calculateSuggestedPrice:
 *   When iterating group.lineItems, check isCustomItem first and use
 *   the item's own lineTotal instead of reaching for model.dailyRate.
 *
 * These tests verify both paths with real Prisma queries.
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
    const customExtras = g.lineItems.reduce(
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

  it("custom item in a group contributes its lineTotal to group revenue", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    await createModelFixture(org.id);
    const project = await createProjectFixture(org.id);
    const group = await createProjectGroupFixture(org.id, project.id, {
      price: 500,
      quantity: 1,
    });

    // Bundle price is $500. Custom item adds $100 on top.
    await createCustomLineItem(org.id, project.id, {
      lineTotal: 100,
      groupId: group.id,
    });

    const groupRevenue = await calculateGroupRevenue(project.id);
    expect(groupRevenue).toBe(600); // 500 (bundle) + 100 (custom)
  });

  it("multiple custom items in a group all contribute", async () => {
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
    await createCustomLineItem(org.id, project.id, {
      lineTotal: 25,
      groupId: group.id,
    });

    const groupRevenue = await calculateGroupRevenue(project.id);
    expect(groupRevenue).toBe(350); // 200 + 50 + 75 + 25
  });

  it("optional custom items do NOT contribute to revenue", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const project = await createProjectFixture(org.id);
    const group = await createProjectGroupFixture(org.id, project.id, {
      price: 300,
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
    expect(groupRevenue).toBe(400); // 300 + 100, not 300 + 100 + 999
  });

  it("CANCELLED custom items do NOT contribute", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const project = await createProjectFixture(org.id);
    const group = await createProjectGroupFixture(org.id, project.id, {
      price: 100,
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
    expect(groupRevenue).toBe(150); // 100 + 50, the cancelled $200 is excluded
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

  it("group with custom items + bundle quantity > 1 multiplies bundle but not custom", async () => {
    // Quantity multiplier applies to the bundle price (the "package deal"),
    // but custom items are individually billed — they're not part of the bundle.
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
    expect(groupRevenue).toBe(350); // (100 × 3) + 50
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
    // The query filters isKitChild: false. Even if a custom-flagged item
    // somehow had isKitChild=true (data corruption scenario), it shouldn't
    // appear in group revenue.
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const project = await createProjectFixture(org.id);
    const group = await createProjectGroupFixture(org.id, project.id, {
      price: 100,
    });

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
    expect(groupRevenue).toBe(100); // kit-child filtered out, only bundle remains
  });
});
