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

import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/prisma";
import { MIRROR_REGISTRY } from "./convex-mirror-registry";

// Reuse the APP Prisma singleton (`@/lib/prisma`) rather than a second client.
//
// The migrated server actions under test write/read via `@/lib/prisma`. If the
// fixtures used a SEPARATE PrismaClient, the two pools race on the same
// gearflow_test DB — the per-test `TRUNCATE … CASCADE` deadlocks against a
// connection the app singleton is still holding ("deadlock detected"). Sharing
// one client+pool removes that whole class of flake AND guarantees fixtures and
// the code under test see the same rows. vitest --pool=forks gives each test
// FILE its own process, so the singleton is still file-isolated.
//
// NOTE: env.ts already defaults NODE_ENV=test; the app singleton points at
// whatever DATABASE_URL the runner set (gearflow_test).
//
// AUTO-MIRROR: `testPrisma` is a thin Proxy over the singleton. For each model
// delegate it returns a wrapped delegate whose write methods (create /
// createMany / update / updateMany / upsert / delete) run the REAL Prisma op
// first, then — at the plain JS level, OUTSIDE any Prisma transaction — replay
// the same write into dev Convex via the registry (see convex-mirror-registry.ts).
//
// IMPORTANT — why a Proxy and not `prisma.$extends({ query })`: a $extends query
// hook that awaits long network work (the Convex round-trip) BETWEEN `query()`
// and its return runs that work inside Prisma's operation/transaction envelope.
// Empirically that corrupts the engine's transaction state — the just-written
// row (and others) get rolled back / wiped, which surfaced as phantom FK
// violations and table truncation. Doing the mirror as an ordinary post-op await
// at the call site (this Proxy) keeps the Convex I/O entirely outside Prisma.
//
// Reads and every non-write member pass straight through. Server actions use the
// un-wrapped `prisma`, so their OWN mirrors aren't double-fired.

const WRITE_METHODS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "upsert",
  "delete",
]);

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

// Map a delegate accessor (camelCase, e.g. "projectLineItem") to the registry key
// (PascalCase model name, e.g. "ProjectLineItem").
function modelKey(delegateName: string): string {
  return delegateName.charAt(0).toUpperCase() + delegateName.slice(1);
}

/** Re-read a row by id and mirror it (create-if-missing + patch) to Convex. */
async function mirrorById(model: string, id: string | undefined): Promise<void> {
  const entry = MIRROR_REGISTRY[model];
  if (!entry || !id) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fresh = await (prisma as any)[lowerFirst(model)].findUnique({ where: { id } });
  if (!fresh) return;
  await entry.create(fresh as Record<string, unknown>);
  await entry.patch(id, fresh as Record<string, unknown>);
}

/** Mirror every row matched by a where-clause (updateMany / deleteMany helpers). */
async function mirrorWhere(model: string, where: unknown): Promise<void> {
  const entry = MIRROR_REGISTRY[model];
  if (!entry) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (prisma as any)[lowerFirst(model)].findMany({ where });
  for (const row of rows as Array<{ id: string }>) {
    await entry.create(row as Record<string, unknown>);
    await entry.patch(row.id, row as Record<string, unknown>);
  }
}

function wrapDelegate(delegateName: string, delegate: Record<string, unknown>): unknown {
  const model = modelKey(delegateName);
  if (!MIRROR_REGISTRY[model]) return delegate; // not Convex-backed — pass through
  return new Proxy(delegate, {
    get(target, prop: string) {
      const orig = (target as Record<string, unknown>)[prop];
      if (typeof orig !== "function" || !WRITE_METHODS.has(prop)) return orig;
      return async (args: Record<string, unknown>) => {
        const result = await (orig as (a: unknown) => Promise<unknown>).call(target, args);
        const entry = MIRROR_REGISTRY[model]!;
        if (prop === "delete") {
          const id = (result as { id?: string } | null)?.id;
          if (id) await entry.remove(id);
        } else if (prop === "createMany" || prop === "createManyAndReturn") {
          const data = Array.isArray(args?.data) ? args.data : [args?.data];
          for (const d of data) await mirrorById(model, (d as { id?: string })?.id);
        } else if (prop === "updateMany") {
          await mirrorWhere(model, args?.where);
        } else {
          // create / update / upsert all return the affected row.
          await mirrorById(model, (result as { id?: string } | null)?.id);
        }
        return result;
      };
    },
  });
}

export const testPrisma: typeof prisma = new Proxy(prisma, {
  get(target, prop: string) {
    const value = (target as unknown as Record<string, unknown>)[prop];
    // Model delegates are objects with a `create`/`findMany` etc. Wrap only those
    // that are Convex-backed; everything else ($queryRaw, $transaction, $connect,
    // user/member/organization delegates, …) passes straight through.
    if (
      value &&
      typeof value === "object" &&
      !prop.startsWith("$") &&
      typeof (value as Record<string, unknown>).create === "function"
    ) {
      return wrapDelegate(prop, value as Record<string, unknown>);
    }
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
  },
}) as unknown as typeof prisma;

/**
 * Truncates every table except _prisma_migrations. Cheap (~50ms on a
 * modest DB) and removes all the fixture noise between tests.
 *
 * Uses CASCADE so we don't have to topologically sort the schema —
 * Postgres handles the FK chain for us.
 */
// Tables that must SURVIVE the per-test TRUNCATE. `jwks` holds the ES256 keypair
// dev Convex trusts (copied in once by integration-globalsetup.ts). Wiping it
// every test would make the minted Convex service token un-trusted, so every
// Convex-backed read/write would fail. Keep this list minimal.
const TRUNCATE_EXCLUDE = new Set(["_prisma_migrations", "jwks"]);

export async function truncateAllTables(): Promise<void> {
  const allTables = await testPrisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
  `;
  const tables = allTables.filter((t) => !TRUNCATE_EXCLUDE.has(t.tablename));
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
// Convex mirroring
// ---------------------------------------------------------------------------
//
// Domain data is now Convex-only for the migrated surfaces: the converted
// server actions and read helpers look in Convex, not Prisma. So a fixture that
// only writes the Prisma test row is invisible to the code under test. Every
// fixture below ALSO mirrors its created row into the shared dev Convex
// deployment, reusing the SAME mirror helpers (`src/lib/*-mirror.ts`) the
// inverted server actions use — so the test fixture and production write produce
// byte-identical Convex docs.
//
// No Convex truncation is needed: each test uses a FRESH unique org id (every
// fixture chain roots at createOrgFixture, which generates a new cuid), so docs
// accumulated in dev Convex across runs stay org-isolated and never collide.
// `createIfMissing` is idempotent, so a re-run with the same id is a no-op.

// NOTE: Organizations themselves stay in Prisma (Better Auth owns them). Convex
// has no `organizations` table — org scoping is by the `organizationId` string
// only, and the service token grants cross-org access. So orgs are NOT mirrored.
//
// The fixtures below write through `testPrisma` (the $extends-wrapped client
// above), so their Convex mirror happens AUTOMATICALLY — no explicit mirror call
// is needed here, and the same auto-mirror covers tests that build rows directly
// via testPrisma.<model>.create(...).

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
    // Use individual create()s (not createMany) so each generated cuid flows
    // through the auto-mirror — createMany hides the rows and we'd need a manual
    // re-read. Per-row create keeps the Convex mirror complete + simple.
    for (const b of options.bulkItems) {
      await testPrisma.kitBulkItem.create({
        data: {
          organizationId: orgId,
          kitId: kit.id,
          bulkAssetId: b.bulkAssetId,
          quantity: b.quantity,
          addedById: options.userId,
        },
      });
    }
  }
  return kit;
}

// Project / line-item fixtures intentionally omitted — Wave 1 regression
// tests don't need them. Add when later waves require project-level
// integration tests (e.g. operational P&L in Wave 2).
