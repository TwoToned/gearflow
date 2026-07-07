// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

// import.meta.glob typed via convex/import-meta-glob.d.ts (see convex/rbac.test.ts).
const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const USER = "user_1";
const asUser = (orgId: string) => ({ subject: USER, orgId });

async function seed(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "viewer" });
    await ctx.db.insert("assets", { id: "a1", organizationId: ORG, modelId: "m1", assetTag: "A1", status: "AVAILABLE" });

    // A file with an S3 storageKey — must NOT reach the browser.
    await ctx.db.insert("fileUploads", {
      id: "f1",
      organizationId: ORG,
      fileName: "manual.pdf",
      fileSize: 4242,
      mimeType: "application/pdf",
      storageKey: "org_1/secret/manual.pdf",
      url: "https://cdn/manual.pdf",
      thumbnailUrl: undefined,
      uploadedById: USER,
    });
    await ctx.db.insert("assetMedia", { id: "am1", organizationId: ORG, assetId: "a1", fileId: "f1", type: "DOCUMENT" });
  });
}

describe("assetDetail.bundle — allowlist DTOs (§3.5)", () => {
  test("files carry display metadata but never storageKey / uploadedById", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const res = await t.withIdentity(asUser(ORG)).query(api.assetDetail.bundle, { assetId: "a1", orgId: ORG });
    expect(res).not.toBeNull();
    const file = res!.files.find((f) => f.id === "f1")!;
    expect(file).toMatchObject({
      id: "f1",
      fileName: "manual.pdf",
      fileSize: 4242,
      mimeType: "application/pdf",
      url: "https://cdn/manual.pdf",
    });
    for (const forbidden of ["storageKey", "uploadedById", "width", "height", "organizationId"]) {
      expect(file).not.toHaveProperty(forbidden);
    }
  });
});
