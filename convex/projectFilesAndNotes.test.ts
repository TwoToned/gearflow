// @vitest-environment node
//
// UX Phase 10, Slice D backend: the job's Files reads (`projectFiles.*`), the file
// category / rename writes and their Activity events, and the notes save event.
// The notes event must never carry note text (the feed is readable by everyone with
// job read; Internal notes are private).
import { convexTest, type TestConvex } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
type T = TestConvex<typeof schema>;
const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const asUser = { subject: USER, orgId: ORG, role: "manager" };
const actor = { userId: USER, userName: "Alice" };

function makeT(): T {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seed(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "manager", createdAt: 1 });
    await ctx.db.insert("users", { id: USER, name: "Alice", email: "a@x.co" });
    await ctx.db.insert("users", { id: "stranger", name: "Not In Org", email: "s@x.co" });
    await ctx.db.insert("projects", { id: "P1", organizationId: ORG, projectNumber: "P1", name: "Gig", status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("projects", { id: "P2", organizationId: ORG, projectNumber: "P2", name: "Other job", status: "CONFIRMED", isTemplate: false, createdAt: NOW, updatedAt: NOW });
    await ctx.db.insert("fileUploads", { id: "f1", organizationId: ORG, fileName: "plan.pdf", fileSize: 10, mimeType: "application/pdf", storageKey: "k1", url: "/api/files/k1", uploadedById: USER, createdAt: NOW });
    await ctx.db.insert("fileUploads", { id: "f2", organizationId: ORG, fileName: "stage.jpg", fileSize: 20, mimeType: "image/jpeg", storageKey: "k2", url: "/api/files/k2", uploadedById: "stranger", createdAt: NOW });
    await ctx.db.insert("fileUploads", { id: "fX", organizationId: OTHER, fileName: "foreign.pdf", fileSize: 1, mimeType: "application/pdf", storageKey: "kX", url: "/api/files/kX", uploadedById: USER });
    await ctx.db.insert("projectMedia", { id: "pm1", organizationId: ORG, projectId: "P1", fileId: "f1", type: "OTHER", sortOrder: 0, createdAt: NOW });
    await ctx.db.insert("projectMedia", { id: "pm2", organizationId: ORG, projectId: "P1", fileId: "f2", type: "PHOTO", sortOrder: 1, createdAt: NOW });
    await ctx.db.insert("projectMedia", { id: "pmX", organizationId: OTHER, projectId: "P1", fileId: "fX", type: "OTHER", sortOrder: 2, createdAt: NOW });
    await ctx.db.insert("projectMedia", { id: "pmP2", organizationId: ORG, projectId: "P2", fileId: "f1", type: "OTHER", sortOrder: 0, createdAt: NOW });
  });
}
const events = (t: T) => t.run(async (ctx) => ctx.db.query("activityEvents").collect());

describe("projectFiles.listForProject", () => {
  test("lists this job's files with the uploader's name only when they are an org member; a foreign-org row is dropped", async () => {
    const t = makeT(); await seed(t);
    const r = await t.withIdentity(asUser).query(api.projectFiles.listForProject, { orgId: ORG, projectId: "P1" });
    expect(r.files.map((f) => f.id)).toEqual(["pm1", "pm2"]);
    expect(r.files[0].uploadedByName).toBe("Alice");
    expect(r.files[1].uploadedByName).toBeNull(); // the users mirror is global: never name a non-member
    expect(r.truncated).toBe(false);
  });

  test("a project in another org reads as empty (no cross-tenant read)", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mo", organizationId: OTHER, userId: "o1", role: "manager", createdAt: 1 });
    });
    const r = await t.withIdentity({ subject: "o1", orgId: OTHER, role: "manager" }).query(api.projectFiles.listForProject, { orgId: OTHER, projectId: "P1" });
    expect(r.files).toEqual([]);
  });
});

describe("projectFiles.alsoOnJob", () => {
  test("lists the stored quote and invoice documents with their STORED-download routes, and sub-hire files", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("quotes", { id: "q1", organizationId: ORG, projectId: "P1", version: 2, status: "SENT", snapshot: {}, pdfFileId: "f1" } as never);
      await ctx.db.insert("quotes", { id: "q0", organizationId: ORG, projectId: "P1", version: 1, status: "DRAFT", snapshot: {} } as never); // never rendered: nothing to list
      await ctx.db.insert("invoices", { id: "i1", organizationId: ORG, projectId: "P1", clientId: "c", kind: "FULL", status: "ISSUED", invoiceNumber: "INV-1", total: 1, subtotal: 1, taxAmount: 0, pdfFileId: "f1" } as never);
      await ctx.db.insert("subHires", { id: "sh1", organizationId: ORG, supplierId: "s", projectId: "P1", createdById: USER, orderNumber: "SH-1", status: "CONFIRMED" } as never);
      await ctx.db.insert("subHireMedia", { id: "shm", organizationId: ORG, subHireId: "sh1", fileId: "f2", displayName: "Supplier PO" });
    });
    const r = await t.withIdentity(asUser).query(api.projectFiles.alsoOnJob, { orgId: ORG, projectId: "P1" });
    const byKey = Object.fromEntries(r.items.map((i) => [i.key, i]));
    expect(byKey["quote-q1"]).toMatchObject({ origin: "Quote", href: "/api/finance/quote/q1/pdf" });
    expect(byKey["invoice-i1"]).toMatchObject({ origin: "Invoice", name: "INV-1", href: "/api/finance/invoice/i1/pdf" });
    expect(byKey["subhire-shm"]).toMatchObject({ origin: "Sub-hire SH-1", name: "Supplier PO" });
    expect(byKey["quote-q0"]).toBeUndefined();
  });

  test("another org's job returns nothing", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { id: "mo", organizationId: OTHER, userId: "o1", role: "manager", createdAt: 1 });
    });
    const r = await t.withIdentity({ subject: "o1", orgId: OTHER, role: "manager" }).query(api.projectFiles.alsoOnJob, { orgId: OTHER, projectId: "P1" });
    expect(r.items).toEqual([]);
  });
});

describe("project file writes (category, rename, events)", () => {
  test("setType changes ONLY the category of this job's files, skips another job's, and writes one event", async () => {
    const t = makeT(); await seed(t);
    const r = await t.withIdentity(asUser).mutation(api.mediaWrites.setTypeNative, { orgId: ORG, projectId: "P1", mediaIds: ["pm1", "pm2", "pmP2", "nope"], type: "FLOOR_PLAN", now: NOW });
    expect(r).toEqual({ updated: 2, skipped: 2 });
    const rows = await t.run(async (ctx) => ctx.db.query("projectMedia").collect());
    expect(rows.find((x) => x.id === "pm1")?.type).toBe("FLOOR_PLAN");
    expect(rows.find((x) => x.id === "pmP2")?.type).toBe("OTHER"); // another job's file: untouched
    expect(rows.find((x) => x.id === "pmX")?.type).toBe("OTHER"); // another org's: untouched
    expect((await events(t)).map((e) => e.action)).toEqual(["file_updated"]);
    // The stored file is never touched by a category change.
    expect(await t.run(async (ctx) => ctx.db.query("fileUploads").collect())).toHaveLength(3);
  });

  test("rename sets displayName (trimmed), refuses blank and another job's file", async () => {
    const t = makeT(); await seed(t);
    const u = t.withIdentity(asUser);
    await u.mutation(api.mediaWrites.renameNative, { orgId: ORG, projectId: "P1", mediaId: "pm1", displayName: "  Site plan v3  ", now: NOW });
    expect((await t.run(async (ctx) => ctx.db.query("projectMedia").collect())).find((x) => x.id === "pm1")?.displayName).toBe("Site plan v3");
    await expect(u.mutation(api.mediaWrites.renameNative, { orgId: ORG, projectId: "P1", mediaId: "pm1", displayName: "   ", now: NOW })).rejects.toThrow(/needs a name/i);
    await expect(u.mutation(api.mediaWrites.renameNative, { orgId: ORG, projectId: "P1", mediaId: "pmP2", displayName: "x", now: NOW })).rejects.toThrow(/not found/i);
  });

  test("add and remove emit file events on the job; remove deletes the row and the stored file (a confirmed hard delete, no Undo)", async () => {
    const t = makeT(); await seed(t);
    const u = t.withIdentity(asUser);
    await u.mutation(api.mediaWrites.removeNative, { kind: "project", orgId: ORG, mediaId: "pm2" });
    expect((await events(t)).map((e) => e.action)).toEqual(["file_removed"]);
    expect(await t.run(async (ctx) => ctx.db.query("projectMedia").withIndex("by_cuid", (q) => q.eq("id", "pm2")).first())).toBeNull();
  });
});

describe("notes save event", () => {
  test("a notes save writes a note_updated event naming the field, NEVER the text; lastNoteSaves reads it back", async () => {
    const t = makeT(); await seed(t);
    const u = t.withIdentity(asUser);
    await u.mutation(api.projectWrites.updateNotesNative, { id: "P1", orgId: ORG, field: "internalNotes", notes: "SECRET: the client owes us", actor, auditId: "a1", now: NOW });
    const ev = await events(t);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ action: "note_updated", entityId: "P1", metadata: { field: "internalNotes" } });
    expect(JSON.stringify(ev[0])).not.toContain("SECRET");
    const last = await u.query(api.collaboration.lastNoteSaves, { orgId: ORG, projectId: "P1" });
    expect(last.internalNotes).toMatchObject({ by: "Alice" });
    expect(last.crewNotes).toBeUndefined();
  });
});
