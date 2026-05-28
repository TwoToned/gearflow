/**
 * Integration tests for collapse-historic-splits.ts.
 *
 * Builds the exact "1 priced parent + N qty=1 split children" shape
 * we see in pre-cutover production data and asserts the script:
 *   - finds the group
 *   - moves each child's assetId onto a unit on the canonical
 *   - cancels the children
 *   - does NOT change the canonical's quantity (parent qty already
 *     accounted for the whole line — children were peeled off it)
 *   - rolls up the canonical so packedQuantity / assignedQuantity
 *     reflect the moved units
 *   - is idempotent (a second run is a no-op)
 *
 * The script's logic is in scripts/collapse-historic-splits.ts; we
 * spawn the script as a child process to exercise the actual CLI
 * surface against the test DB.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { createId } from "@paralleldrive/cuid2";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
  createModelFixture,
  createAssetFixture,
} from "../helpers/integration";

const SCRIPT_PATH = "scripts/collapse-historic-splits.ts";
const TEST_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/gearflow_test";

function runScript(args: string[] = []) {
  const result = spawnSync("npx", ["tsx", SCRIPT_PATH, ...args], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`script exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result.stdout;
}

async function createProject(orgId: string) {
  return testPrisma.project.create({
    data: {
      organizationId: orgId,
      projectNumber: `P-${createId().slice(0, 8)}`,
      name: "Historic test",
      taxRate: 0,
    },
  });
}

/** Build the historic split-sibling shape on one project. */
async function createSplitGroup(
  orgId: string,
  projectId: string,
  modelId: string,
  args: {
    parentQty: number;
    parentUnitPrice: number;
    childCount: number;
    /** Per-child assetIds. */
    childAssetIds: string[];
  },
) {
  if (args.childAssetIds.length !== args.childCount) {
    throw new Error("childAssetIds count must match childCount");
  }
  const parent = await testPrisma.projectLineItem.create({
    data: {
      organizationId: orgId,
      projectId,
      modelId,
      type: "EQUIPMENT",
      quantity: args.parentQty,
      unitPrice: args.parentUnitPrice,
      lineTotal: args.parentUnitPrice * args.parentQty,
      pricingType: "PER_DAY",
      duration: 1,
      status: "CONFIRMED",
      sortOrder: 0,
    },
  });
  const children = [];
  for (let i = 0; i < args.childCount; i++) {
    const c = await testPrisma.projectLineItem.create({
      data: {
        organizationId: orgId,
        projectId,
        modelId,
        type: "EQUIPMENT",
        quantity: 1,
        unitPrice: 0,
        lineTotal: 0,
        pricingType: "PER_DAY",
        duration: 1,
        assetId: args.childAssetIds[i],
        status: "CONFIRMED",
        sortOrder: i + 1,
      },
    });
    children.push(c);
  }
  return { parent, children };
}

describe("collapse-historic-splits script", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("merges N split children into the priced parent with N units", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const project = await createProject(org.id);

    const assets = [];
    for (let i = 0; i < 5; i++) {
      const a = await createAssetFixture(org.id, model.id, {
        assetTag: `HS-${i}`,
      });
      assets.push(a);
    }

    const { parent, children } = await createSplitGroup(org.id, project.id, model.id, {
      parentQty: 5,
      parentUnitPrice: 27,
      childCount: 5,
      childAssetIds: assets.map((a) => a.id),
    });

    // Dry-run first — must find the group without writing anything.
    const dryOut = runScript(["--project", project.id]);
    expect(dryOut).toContain("Mergeable groups:  1");
    expect(dryOut).toContain("Flagged:           0");
    expect(dryOut).toContain("Re-run with --apply to execute.");

    // Pre-apply state untouched.
    let parentAfter = await testPrisma.projectLineItem.findUniqueOrThrow({
      where: { id: parent.id },
    });
    expect(parentAfter.quantity).toBe(5);
    let units = await testPrisma.projectLineItemUnit.findMany({
      where: { lineItemId: parent.id },
    });
    expect(units).toHaveLength(0);

    // Apply.
    const applyOut = runScript(["--project", project.id, "--apply"]);
    expect(applyOut).toContain("Mergeable groups:        1");

    // Canonical: same qty, now has 5 units.
    parentAfter = await testPrisma.projectLineItem.findUniqueOrThrow({
      where: { id: parent.id },
    });
    expect(parentAfter.quantity).toBe(5);
    expect(parentAfter.status).not.toBe("CANCELLED");

    units = await testPrisma.projectLineItemUnit.findMany({
      where: { lineItemId: parent.id },
      orderBy: { ordinal: "asc" },
    });
    expect(units).toHaveLength(5);
    expect(new Set(units.map((u) => u.assetId))).toEqual(
      new Set(assets.map((a) => a.id)),
    );

    // Children: inert.
    for (const c of children) {
      const refreshed = await testPrisma.projectLineItem.findUniqueOrThrow({
        where: { id: c.id },
      });
      expect(refreshed.status).toBe("CANCELLED");
      expect(refreshed.quantity).toBe(0);
      expect(refreshed.assetId).toBeNull();
    }

    // Rollup reflects the moved units.
    expect(parentAfter.assignedQuantity).toBe(5);

    // Audit rows exist.
    const audit = await testPrisma.lineItemMergeMap.findMany({
      where: { canonicalLineItemId: parent.id },
    });
    expect(audit).toHaveLength(5);
    expect(audit.every((a) => a.notes?.includes("historic-splits"))).toBe(true);

    // Idempotent.
    const second = runScript(["--project", project.id, "--apply"]);
    expect(second).toContain("Mergeable groups:        0");
  });

  it("flags a group where child qty sum exceeds parent qty (data smell)", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const project = await createProject(org.id);

    // Parent qty=2 but 3 split children — suspect data; don't touch.
    const assets = [];
    for (let i = 0; i < 3; i++) {
      const a = await createAssetFixture(org.id, model.id, {
        assetTag: `OV-${i}`,
      });
      assets.push(a);
    }
    await createSplitGroup(org.id, project.id, model.id, {
      parentQty: 2,
      parentUnitPrice: 27,
      childCount: 3,
      childAssetIds: assets.map((a) => a.id),
    });

    const out = runScript(["--project", project.id, "--apply"]);
    expect(out).toContain("Flagged:           1");
    expect(out).toContain("child qty sum (3) > parent qty (2)");
    expect(out).toContain("Mergeable groups:        0");
  });

  it("flags two priced parents in the same bucket (ambiguous canonical)", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const project = await createProject(org.id);

    // Two parent rows with the same order-level key — refuse to pick.
    await testPrisma.projectLineItem.create({
      data: {
        organizationId: org.id, projectId: project.id, modelId: model.id,
        type: "EQUIPMENT", quantity: 2, unitPrice: 27, lineTotal: 54,
        pricingType: "PER_DAY", duration: 1, status: "CONFIRMED", sortOrder: 0,
      },
    });
    await testPrisma.projectLineItem.create({
      data: {
        organizationId: org.id, projectId: project.id, modelId: model.id,
        type: "EQUIPMENT", quantity: 1, unitPrice: 27, lineTotal: 27,
        pricingType: "PER_DAY", duration: 1, status: "CONFIRMED", sortOrder: 1,
      },
    });
    const asset = await createAssetFixture(org.id, model.id, {
      assetTag: "AMB-1",
    });
    await testPrisma.projectLineItem.create({
      data: {
        organizationId: org.id, projectId: project.id, modelId: model.id,
        type: "EQUIPMENT", quantity: 1, unitPrice: 0, lineTotal: 0,
        pricingType: "PER_DAY", duration: 1, assetId: asset.id,
        status: "CONFIRMED", sortOrder: 2,
      },
    });

    const out = runScript(["--project", project.id, "--apply"]);
    expect(out).toContain("ambiguous canonical");
    expect(out).toContain("Mergeable groups:        0");
  });

  it("leaves a clean line (no splits) untouched", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);
    const model = await createModelFixture(org.id);
    const project = await createProject(org.id);

    const line = await testPrisma.projectLineItem.create({
      data: {
        organizationId: org.id, projectId: project.id, modelId: model.id,
        type: "EQUIPMENT", quantity: 5, unitPrice: 27, lineTotal: 135,
        pricingType: "PER_DAY", duration: 1, status: "CONFIRMED", sortOrder: 0,
      },
    });

    const out = runScript(["--project", project.id, "--apply"]);
    expect(out).toContain("Mergeable groups:        0");

    const refreshed = await testPrisma.projectLineItem.findUniqueOrThrow({
      where: { id: line.id },
    });
    expect(refreshed.quantity).toBe(5);
    expect(refreshed.status).toBe("CONFIRMED");
  });
});
