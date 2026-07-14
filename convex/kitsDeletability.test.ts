// @vitest-environment node
//
// kits.deletability — browser-native replacement for canDeleteKit. Verifies the
// archive/hard-delete decision (computeKitDeletability parity), the referencing
// line-item count (by_kitId, org-filtered), org isolation, and RBAC.
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

const seedMember = (t: ReturnType<typeof makeT>) =>
  t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role: "admin" });
  });

const insertKit = (
  t: ReturnType<typeof makeT>,
  id: string,
  org: string,
  status: string | undefined,
  isActive: boolean | undefined,
) =>
  t.run(async (ctx) => {
    await ctx.db.insert("kits", {
      id,
      organizationId: org,
      assetTag: "KIT-" + id,
      name: "Kit " + id,
      ...(status !== undefined ? { status: status as never } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    });
  });

const insertLine = (t: ReturnType<typeof makeT>, id: string, org: string, kitId: string) =>
  t.run(async (ctx) => {
    await ctx.db.insert("projectLineItems", { id, organizationId: org, projectId: "p1", kitId });
  });

describe("kits.deletability", () => {
  test("AVAILABLE + no references → archive + hard-delete both allowed", async () => {
    const t = makeT();
    await seedMember(t);
    await insertKit(t, "k1", ORG, "AVAILABLE", true);
    const r = await t.withIdentity(asUser).query(api.kits.deletability, { orgId: ORG, id: "k1" });
    expect(r).toEqual({ canArchive: true, canHardDelete: true, referencingLineItems: 0, reason: undefined });
  });

  test("AVAILABLE + references → archive only, hard-delete blocked", async () => {
    const t = makeT();
    await seedMember(t);
    await insertKit(t, "k1", ORG, "AVAILABLE", true);
    await insertLine(t, "l1", ORG, "k1");
    await insertLine(t, "l2", ORG, "k1");
    await insertLine(t, "lx", OTHER, "k1"); // other-org line must NOT count
    const r = await t.withIdentity(asUser).query(api.kits.deletability, { orgId: ORG, id: "k1" });
    expect(r.canArchive).toBe(true);
    expect(r.canHardDelete).toBe(false);
    expect(r.referencingLineItems).toBe(2);
    expect(r.reason).toContain("2 project line items");
  });

  test("non-AVAILABLE status → neither allowed", async () => {
    const t = makeT();
    await seedMember(t);
    await insertKit(t, "k1", ORG, "CHECKED_OUT", true);
    const r = await t.withIdentity(asUser).query(api.kits.deletability, { orgId: ORG, id: "k1" });
    expect(r.canArchive).toBe(false);
    expect(r.canHardDelete).toBe(false);
    expect(r.reason).toContain("CHECKED_OUT");
  });

  test("inactive (archived) kit → 'already archived'", async () => {
    const t = makeT();
    await seedMember(t);
    await insertKit(t, "k1", ORG, "AVAILABLE", false);
    const r = await t.withIdentity(asUser).query(api.kits.deletability, { orgId: ORG, id: "k1" });
    expect(r.canArchive).toBe(false);
    expect(r.reason).toContain("already archived");
  });

  test("a kit in another org is not readable (cross-tenant)", async () => {
    const t = makeT();
    await seedMember(t);
    await insertKit(t, "k1", OTHER, "AVAILABLE", true);
    await expect(
      t.withIdentity(asUser).query(api.kits.deletability, { orgId: ORG, id: "k1" }),
    ).rejects.toThrow(/not found/i);
  });

  test("rejects a non-member", async () => {
    const t = makeT();
    await seedMember(t);
    await insertKit(t, "k1", ORG, "AVAILABLE", true);
    await expect(
      t.withIdentity({ subject: USER, orgId: "nope" }).query(api.kits.deletability, { orgId: ORG, id: "k1" }),
    ).rejects.toThrow();
  });
});
