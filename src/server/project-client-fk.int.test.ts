/**
 * Integration test for the Clients hard-cutover FK fix (FEATUREDOCS/54).
 *
 * Clients were hard-cutover to Convex: new clients exist ONLY in Convex, never in
 * the frozen Prisma `client` table. The Prisma FKs `project.clientId -> client` and
 * `client_media.clientId -> client` were therefore dropped — otherwise assigning a
 * net-new (Convex-only) client to a project, or uploading media for one, would
 * FK-fail against the frozen table.
 *
 * These tests assert against a real Postgres that writing a `clientId` which has NO
 * matching Prisma `client` row succeeds (i.e. the FK constraint is gone).
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createId } from "@paralleldrive/cuid2";
import {
  testPrisma,
  setupIntegrationTest,
  createOrgFixture,
  createUserFixture,
} from "../../tests/helpers/integration";

describe("Clients hard-cutover FK fix (integration)", () => {
  beforeEach(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("creates a project against a brand-new (Convex-only) client id", async () => {
    const org = await createOrgFixture();
    await createUserFixture(org.id);

    // A clientId that exists in Convex only — no matching Prisma `client` row.
    const convexOnlyClientId = createId();
    expect(
      await testPrisma.client.findUnique({ where: { id: convexOnlyClientId } }),
    ).toBeNull();

    const project = await testPrisma.project.create({
      data: {
        organizationId: org.id,
        projectNumber: `P-${createId().slice(0, 8)}`,
        name: "Project for net-new client",
        clientId: convexOnlyClientId,
      },
    });

    expect(project.clientId).toBe(convexOnlyClientId);
  });

  it("creates client media against a brand-new (Convex-only) client id", async () => {
    const org = await createOrgFixture();
    const user = await createUserFixture(org.id);

    const file = await testPrisma.fileUpload.create({
      data: {
        organizationId: org.id,
        fileName: "contract.pdf",
        fileSize: 1024,
        mimeType: "application/pdf",
        storageKey: `uploads/${createId()}`,
        url: "https://example.test/contract.pdf",
        uploadedById: user.id,
      },
    });

    const convexOnlyClientId = createId();
    const media = await testPrisma.clientMedia.create({
      data: {
        organizationId: org.id,
        clientId: convexOnlyClientId,
        fileId: file.id,
      },
    });

    expect(media.clientId).toBe(convexOnlyClientId);
  });
});
