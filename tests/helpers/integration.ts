/**
 * Integration test harness — runs against a real Postgres test database.
 *
 * Usage:
 *   import { setupIntegrationTest, createOrgFixture } from "@/../tests/helpers/integration";
 *
 *   beforeEach(async () => {
 *     await setupIntegrationTest();
 *   });
 *
 * setupIntegrationTest() truncates every table except _prisma_migrations
 * so each test file starts from a clean slate. Fixture factories below
 * (createOrgFixture, createAssetFixture, etc.) build the test data
 * each suite needs.
 *
 * Test DB connection comes from DATABASE_URL — set by the
 * `npm run test:integration` script to point at gearflow_test.
 */

import { PrismaClient } from "@/generated/prisma/client";
import { createId } from "@paralleldrive/cuid2";

// Single shared client per test process — vitest --pool=forks isolates
// connections across test files, so this is safe.
export const testPrisma = new PrismaClient();

/**
 * Truncates every table except _prisma_migrations. Cheap (~50ms on a
 * modest DB) and removes all the fixture noise between tests.
 *
 * Uses CASCADE so we don't have to topologically sort the schema —
 * Postgres handles the FK chain for us.
 */
export async function truncateAllTables(): Promise<void> {
  const tables = await testPrisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename != '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await testPrisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
}

export async function setupIntegrationTest(): Promise<void> {
  await truncateAllTables();
}

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

export async function createOrgFixture(overrides?: { slug?: string; name?: string }) {
  const id = createId();
  const slug = overrides?.slug ?? `org-${id.slice(0, 8)}`;
  return testPrisma.organization.create({
    data: {
      id,
      name: overrides?.name ?? "Test Org",
      slug,
      createdAt: new Date(),
    },
  });
}

export async function createUserFixture(orgId: string, role: "owner" | "admin" | "member" = "admin") {
  const userId = createId();
  const email = `user-${userId.slice(0, 8)}@test.local`;
  const user = await testPrisma.user.create({
    data: {
      id: userId,
      email,
      name: "Test User",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await testPrisma.member.create({
    data: {
      id: createId(),
      userId: user.id,
      organizationId: orgId,
      role,
      createdAt: new Date(),
    },
  });
  return user;
}

export async function createModelFixture(
  orgId: string,
  overrides?: { name?: string; sku?: string },
) {
  return testPrisma.model.create({
    data: {
      organizationId: orgId,
      name: overrides?.name ?? "Test Model",
      sku: overrides?.sku ?? null,
    },
  });
}

export async function createBulkAssetFixture(
  orgId: string,
  modelId: string,
  options: { assetTag: string; total: number; available?: number },
) {
  return testPrisma.bulkAsset.create({
    data: {
      organizationId: orgId,
      modelId,
      assetTag: options.assetTag,
      totalQuantity: options.total,
      availableQuantity: options.available ?? options.total,
    },
  });
}

export async function createAssetFixture(
  orgId: string,
  modelId: string,
  options: {
    assetTag: string;
    status?: "AVAILABLE" | "CHECKED_OUT" | "IN_MAINTENANCE" | "LOST" | "RETIRED";
    locationId?: string | null;
    kitId?: string | null;
  },
) {
  return testPrisma.asset.create({
    data: {
      organizationId: orgId,
      modelId,
      assetTag: options.assetTag,
      status: options.status ?? "AVAILABLE",
      locationId: options.locationId ?? null,
      kitId: options.kitId ?? null,
    },
  });
}

export async function createKitFixture(
  orgId: string,
  options: { assetTag: string; name?: string; bulkItems?: Array<{ bulkAssetId: string; quantity: number }>; userId: string },
) {
  const kit = await testPrisma.kit.create({
    data: {
      organizationId: orgId,
      assetTag: options.assetTag,
      name: options.name ?? "Test Kit",
    },
  });
  if (options.bulkItems && options.bulkItems.length > 0) {
    await testPrisma.kitBulkItem.createMany({
      data: options.bulkItems.map((b) => ({
        organizationId: orgId,
        kitId: kit.id,
        bulkAssetId: b.bulkAssetId,
        quantity: b.quantity,
        addedById: options.userId,
      })),
    });
  }
  return kit;
}

// Project / line-item fixtures intentionally omitted — Wave 1 regression
// tests don't need them. Add when later waves require project-level
// integration tests (e.g. operational P&L in Wave 2).
