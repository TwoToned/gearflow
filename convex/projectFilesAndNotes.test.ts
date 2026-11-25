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

describe("attaching and removing a file can never destroy bytes that are not the caller's", () => {
  const add = (t: T, fileId: string, id = "pmNew") =>
    t.withIdentity(asUser).mutation(api.mediaWrites.addNative, { kind: "project", id, orgId: ORG, parentId: "P1", fileId, type: "OTHER", now: NOW });
  const fileExists = (t: T, id: string) => t.run(async (ctx) => !!(await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", id)).first()));
  const addUpload = (t: T, id: string, o: { by?: string; folder?: string | null } = {}) =>
    t.run(async (ctx) => {
      await ctx.db.insert("fileUploads", { id, organizationId: ORG, fileName: `${id}.pdf`, fileSize: 1, mimeType: "application/pdf", storageKey: `k-${id}`, url: `/api/files/k-${id}`, uploadedById: o.by ?? USER, createdAt: NOW });
      if (o.folder !== null) await ctx.db.insert("storedFiles", { storageId: `k-${id}`, organizationId: ORG, folder: o.folder ?? "projects" });
    });

  test("the caller's own fresh job upload attaches", async () => {
    const t = makeT(); await seed(t); await addUpload(t, "fNew");
    expect(await add(t, "fNew")).toEqual({ id: "pmNew" });
  });

  test("another person's upload in the same org is refused (cannot be attached, so cannot be removed-and-deleted)", async () => {
    const t = makeT(); await seed(t); await addUpload(t, "fTheirs", { by: "stranger" });
    await expect(add(t, "fTheirs")).rejects.toThrow(/only attach a file you uploaded/i);
    expect(await fileExists(t, "fTheirs")).toBe(true);
  });

  test("a file something already holds (even the caller's own) is refused", async () => {
    const t = makeT(); await seed(t);
    await expect(add(t, "f1")).rejects.toThrow(/already attached/i);
  });

  test("a file from another upload folder (a quote PDF, a check photo) or another org is refused", async () => {
    const t = makeT(); await seed(t); await addUpload(t, "fPdf", { folder: "finance" }); await addUpload(t, "fNoRow", { folder: null });
    await expect(add(t, "fPdf")).rejects.toThrow(/not uploaded to this job/i);
    await expect(add(t, "fNoRow")).rejects.toThrow(/not uploaded to this job/i);
    await expect(add(t, "fX")).rejects.toThrow(/File not found/);
  });

  test("removing a file another row still holds keeps its bytes; the last holder's removal deletes them", async () => {
    const t = makeT(); await seed(t);
    const u = t.withIdentity(asUser);
    await u.mutation(api.mediaWrites.removeNative, { kind: "project", orgId: ORG, mediaId: "pm1" }); // f1 is also held by pmP2
    expect(await fileExists(t, "f1")).toBe(true);
    await u.mutation(api.mediaWrites.removeNative, { kind: "project", orgId: ORG, mediaId: "pmP2" }); // now the last holder
    expect(await fileExists(t, "f1")).toBe(false);
  });
});

describe("removeManyNative (the Files bulk bar: ONE mutation)", () => {
  const many = (t: T, mediaIds: string[], as: object = asUser) => t.withIdentity(as).mutation(api.mediaWrites.removeManyNative, { kind: "project", orgId: ORG, mediaIds });
  const fileExists = (t: T, id: string) => t.run(async (ctx) => !!(await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", id)).first()));

  test("removes several, deletes bytes only for files nothing else holds, and NAMES what it skipped", async () => {
    const t = makeT(); await seed(t);
    const r = await many(t, ["pm1", "pm2", "pmX", "nope", "pm2"]); // pmX is another org's; pm2 repeated; pm1's file f1 is also held by pmP2
    expect(r.removed).toBe(2);
    expect(r.skipped.map((s) => s.id).sort()).toEqual(["nope", "pmX"]);
    expect(await fileExists(t, "f1")).toBe(true); // still held by pmP2
    expect(await fileExists(t, "f2")).toBe(false); // last holder: bytes gone
    expect(await fileExists(t, "fX")).toBe(true); // another org's file untouched
    expect((await events(t)).map((e) => e.action)).toEqual(["file_removed", "file_removed"]);
  });

  test("a viewer cannot remove, and nothing changes", async () => {
    const t = makeT(); await seed(t);
    await t.run(async (ctx) => {
      const m = await ctx.db.query("members").withIndex("by_org_user", (q) => q.eq("organizationId", ORG).eq("userId", USER)).first();
      if (m) await ctx.db.patch(m._id, { role: "viewer" });
    });
    await expect(many(t, ["pm2"], { subject: USER, orgId: ORG, role: "viewer" })).rejects.toThrow();
    expect(await fileExists(t, "f2")).toBe(true);
  });

  test("the bulk size is capped by the verified identity", async () => {
    const t = makeT(); await seed(t);
    await expect(many(t, Array.from({ length: 501 }, (_, i) => `m${i}`))).rejects.toThrow();
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
