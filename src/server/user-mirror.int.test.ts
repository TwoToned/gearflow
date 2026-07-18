/**
 * Integration test for the Better-Auth user → Convex `users` mirror
 * (src/lib/user-mirror.ts + convex/users.ts). The mirror is the unlock that lets
 * detail composites resolve linked users from Convex instead of a cross-domain
 * Prisma join (the version-vector-waterfall fix groundwork).
 *
 * Properties: a user mirrors on create; re-mirroring after an update PATCHES the
 * same row (no duplicate); listByIds returns it.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { setupIntegrationTest, createOrgFixture, createUserFixture } from "../../tests/helpers/integration";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { mirrorUserToConvex, removeUserFromConvex } from "@/lib/user-mirror";
import { prisma } from "@/lib/prisma";

// Requires a real Convex deployment + the service-token trust chain (see
// integration-globalsetup.ts). Gated behind INTEGRATION_CONVEX=1 so the default
// CI integration run (Postgres-only, no private dev infra) skips it — the same
// opt-in pattern as the E2E_HARNESS-gated specs.
describe.skipIf(!process.env.INTEGRATION_CONVEX)(
  "user-mirror — Better Auth user → Convex users",
  () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  it("mirrors on create and patches (not duplicates) on update", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const convex = await getConvexClient();

    // Not mirrored yet.
    expect(await convex.query(api.users.getById, { id: user.id })).toBeNull();

    await mirrorUserToConvex(user.id);
    const mirrored = await convex.query(api.users.getById, { id: user.id });
    expect(mirrored?.id).toBe(user.id);
    expect(mirrored?.name).toBe(user.name);
    expect(mirrored?.email).toBe(user.email);

    // Update in Prisma → re-mirror → the SAME row is patched.
    await prisma.user.update({ where: { id: user.id }, data: { name: "Renamed" } });
    await mirrorUserToConvex(user.id);
    const updated = await convex.query(api.users.getById, { id: user.id });
    expect(updated?.name).toBe("Renamed");
    expect(updated?._id).toBe(mirrored?._id); // same document, not a duplicate

    const batch = await convex.query(api.users.listByIds, { ids: [user.id] });
    expect(batch.map((u) => u.id)).toEqual([user.id]);
  });

  it("clears image on re-mirror (replace semantics, not stale), and removes on delete", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);
    const convex = await getConvexClient();

    await prisma.user.update({ where: { id: user.id }, data: { image: "https://x/a.png" } });
    await mirrorUserToConvex(user.id);
    expect((await convex.query(api.users.getById, { id: user.id }))?.image).toBe("https://x/a.png");

    // Clear the avatar in Prisma → re-mirror → the Convex image must be GONE
    // (replace, not patch — patch would leave the old URL).
    await prisma.user.update({ where: { id: user.id }, data: { image: null } });
    await mirrorUserToConvex(user.id);
    expect((await convex.query(api.users.getById, { id: user.id }))?.image).toBeUndefined();

    // Delete → mirror removal.
    await removeUserFromConvex(user.id);
    expect(await convex.query(api.users.getById, { id: user.id })).toBeNull();
  });
  },
);
