// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER_ORG = "org_2";

async function seedLine(
  t: ReturnType<typeof convexTest>,
  id: string,
  organizationId: string,
  prepStatus: string | undefined,
  createdAt: number,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projectLineItems", {
      id,
      organizationId,
      projectId: "p1",
      description: "Item",
      status: "CONFIRMED",
      type: "EQUIPMENT",
      isKitChild: false,
      prepStatus: prepStatus as never,
      createdAt,
    });
  });
}

describe("projectLineItems.listFlagged", () => {
  test("returns only FLAGGED_FAULTY/FLAGGED_TT_OVERDUE lines for the org, oldest first, capped at limit", async () => {
    const t = convexTest(schema, modules);
    await seedLine(t, "li1", ORG, "FLAGGED_FAULTY", 100);
    await seedLine(t, "li2", ORG, "PENDING", 200);
    await seedLine(t, "li3", ORG, "FLAGGED_TT_OVERDUE", 50);
    await seedLine(t, "li4", ORG, undefined, 25);
    await seedLine(t, "li5", OTHER_ORG, "FLAGGED_FAULTY", 10);

    const result = await t.withIdentity({ subject: "u1", orgId: ORG }).query(api.projectLineItems.listFlagged, {
      orgId: ORG,
      limit: 50,
    });

    expect(result.map((r) => r.id)).toEqual(["li3", "li1"]);
  });

  test("caps at limit across both flagged statuses combined", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 5; i++) await seedLine(t, `f${i}`, ORG, "FLAGGED_FAULTY", i);
    for (let i = 0; i < 5; i++) await seedLine(t, `t${i}`, ORG, "FLAGGED_TT_OVERDUE", i + 100);

    const result = await t.withIdentity({ subject: "u1", orgId: ORG }).query(api.projectLineItems.listFlagged, {
      orgId: ORG,
      limit: 3,
    });

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.id)).toEqual(["f0", "f1", "f2"]);
  });

  test("rejects a user token scoped to a different org", async () => {
    const t = convexTest(schema, modules);
    await seedLine(t, "li1", ORG, "FLAGGED_FAULTY", 1);
    await expect(
      t.withIdentity({ subject: "u1", orgId: OTHER_ORG }).query(api.projectLineItems.listFlagged, { orgId: ORG, limit: 50 }),
    ).rejects.toThrow(/Forbidden/);
  });
});
