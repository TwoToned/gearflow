// @vitest-environment node
//
// clients.detail — browser-native composite replacing the getClient server action.
// Verifies: composes client + recent projects (newest-first, capped 20, with a
// TOTAL line-item count) + media gallery (files resolved, sorted by sortOrder),
// per-row org isolation on the global-index fetches (projects/media/file), and
// null for a missing / cross-org client.
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const asUser = { subject: USER, orgId: ORG };
const makeT = () => convexTest(schema, modules);

async function seed(t: ReturnType<typeof makeT>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "viewer" });
    await ctx.db.insert("clients", { id: "c1", organizationId: ORG, name: "Acme", type: "COMPANY", isActive: true, notes: "hi" });
    await ctx.db.insert("clients", { id: "cX", organizationId: OTHER, name: "Other" });

    // Projects for c1: two owned (different createdAt), one for another client, one cross-org (same clientId!).
    await ctx.db.insert("projects", { id: "p1", organizationId: ORG, projectNumber: "P1", name: "Old", clientId: "c1", createdAt: 100 });
    await ctx.db.insert("projects", { id: "p2", organizationId: ORG, projectNumber: "P2", name: "New", clientId: "c1", createdAt: 200 });
    await ctx.db.insert("projects", { id: "p3", organizationId: ORG, projectNumber: "P3", name: "Nope", clientId: "c2", createdAt: 300 });
    await ctx.db.insert("projects", { id: "pX", organizationId: OTHER, projectNumber: "PX", name: "Foreign", clientId: "c1", createdAt: 400 }); // cross-org, must NOT leak

    // Line items: p1 has 2 (any status/type — count is ALL), p2 has 1.
    await ctx.db.insert("projectLineItems", { id: "li1", organizationId: ORG, projectId: "p1", status: "CANCELLED", quantity: 1 });
    await ctx.db.insert("projectLineItems", { id: "li2", organizationId: ORG, projectId: "p1", status: "CONFIRMED", quantity: 1 });
    await ctx.db.insert("projectLineItems", { id: "li3", organizationId: ORG, projectId: "p2", status: "CONFIRMED", quantity: 1 });
    // Malformed cross-org line item reusing p1's id → must NOT inflate p1's count.
    await ctx.db.insert("projectLineItems", { id: "liX", organizationId: OTHER, projectId: "p1", status: "CONFIRMED", quantity: 1 });

    // A file + two media rows (out-of-order sortOrder) + a media row whose file is missing.
    await ctx.db.insert("fileUploads", { id: "f1", organizationId: ORG, fileName: "a.pdf", fileSize: 10, mimeType: "application/pdf", storageKey: "k1", url: "http://x/a.pdf", uploadedById: USER });
    await ctx.db.insert("fileUploads", { id: "f2", organizationId: ORG, fileName: "b.png", fileSize: 20, mimeType: "image/png", storageKey: "k2", url: "http://x/b.png", uploadedById: USER });
    await ctx.db.insert("clientMedia", { id: "cm1", organizationId: ORG, clientId: "c1", fileId: "f2", sortOrder: 2, type: "OTHER" });
    await ctx.db.insert("clientMedia", { id: "cm2", organizationId: ORG, clientId: "c1", fileId: "f1", sortOrder: 1, type: "OTHER" });
    await ctx.db.insert("clientMedia", { id: "cm3", organizationId: ORG, clientId: "c1", fileId: "missing", sortOrder: 3, type: "OTHER" }); // dropped (unresolved file)
  });
}

describe("clients.detail", () => {
  test("composes client + recent projects (counts) + resolved media; no cross-org leak", async () => {
    const t = makeT();
    await seed(t);
    const detail = await t.withIdentity(asUser).query(api.clients.detail, { orgId: ORG, id: "c1" });
    expect(detail).not.toBeNull();
    expect(detail!.name).toBe("Acme");
    expect(detail!.notes).toBe("hi");

    // Projects: only c1's OWN-org projects, newest first (p2 before p1); pX (cross-org) excluded.
    expect(detail!.projects.map((p) => p.id)).toEqual(["p2", "p1"]);
    // Line-item counts are TOTAL rows (incl. CANCELLED): p1=2, p2=1.
    const byId = Object.fromEntries(detail!.projects.map((p) => [p.id, p._count.lineItems]));
    expect(byId).toEqual({ p1: 2, p2: 1 });

    // Media: sorted by sortOrder (f1 then f2), the missing-file row dropped, file resolved.
    expect(detail!.media.map((m) => m.file.id)).toEqual(["f1", "f2"]);
    expect(detail!.media[0].file).toMatchObject({ fileName: "a.pdf", url: "http://x/a.pdf" });
  });

  test("returns null for a missing or cross-org client", async () => {
    const t = makeT();
    await seed(t);
    expect(await t.withIdentity(asUser).query(api.clients.detail, { orgId: ORG, id: "missing" })).toBeNull();
    // cX belongs to OTHER → viewer in ORG gets null (not a cross-tenant read).
    expect(await t.withIdentity(asUser).query(api.clients.detail, { orgId: ORG, id: "cX" })).toBeNull();
  });

  test("rejects a non-member", async () => {
    const t = makeT();
    await seed(t);
    await expect(
      t.withIdentity({ subject: USER, orgId: "nope" }).query(api.clients.detail, { orgId: ORG, id: "c1" }),
    ).rejects.toThrow();
  });
});
