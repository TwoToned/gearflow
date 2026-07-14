// @vitest-environment node
//
// convex/customFieldDefinitionsWrites.ts — browser-direct custom-field-definition
// writes. Verifies the wave-2 shape: create with the unique-fieldKey guard, update
// (immutable fieldKey/entityType/createdAt), delete, per-row org re-check (no
// cross-tenant write), RBAC (orgSettings:update), and atomic audit.
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { describe, test, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const ORG = "org_1";
const OTHER = "org_2";
const USER = "user_1";
const NOW = 1_700_000_000_000;
const actor = { userId: USER, userName: "Alice" };
const asUser = { subject: USER, orgId: ORG };

function makeT() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

async function seedMember(t: ReturnType<typeof makeT>, role = "owner") {
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { id: "m1", organizationId: ORG, userId: USER, role });
  });
}

const getDef = (t: ReturnType<typeof makeT>, id: string) =>
  t.run(async (ctx) => ctx.db.query("customFieldDefinitions").withIndex("by_cuid", (q) => q.eq("id", id)).first());

const baseCreate = {
  entityType: "ASSET" as const,
  label: "Rig Number",
  fieldKey: "rigNumber",
  fieldType: "TEXT" as const,
  options: [],
  required: false,
  sortOrder: 0,
  isActive: true,
};

describe("customFieldDefinitionsWrites", () => {
  test("create → update → remove, with audit", async () => {
    const t = makeT();
    await seedMember(t);

    await t.withIdentity(asUser).mutation(api.customFieldDefinitionsWrites.createNative, {
      id: "d1", organizationId: ORG, ...baseCreate, createdAt: NOW, actor, auditId: "a1",
    });
    const created = await getDef(t, "d1");
    expect(created?.label).toBe("Rig Number");
    expect(created?.fieldKey).toBe("rigNumber");
    expect(created?.updatedAt).toBe(NOW);

    await t.withIdentity(asUser).mutation(api.customFieldDefinitionsWrites.updateNative, {
      id: "d1", orgId: ORG, label: "Rig No.", fieldType: "TEXT", options: [], required: true,
      sortOrder: 2, isActive: false, actor, auditId: "a2", now: NOW + 1,
    });
    const updated = await getDef(t, "d1");
    expect(updated?.label).toBe("Rig No.");
    expect(updated?.required).toBe(true);
    expect(updated?.isActive).toBe(false);
    expect(updated?.fieldKey).toBe("rigNumber"); // immutable
    expect(updated?.entityType).toBe("ASSET"); // immutable
    expect(updated?.createdAt).toBe(NOW); // immutable

    await t.withIdentity(asUser).mutation(api.customFieldDefinitionsWrites.removeNative, {
      id: "d1", orgId: ORG, actor, auditId: "a3", now: NOW + 2,
    });
    expect(await getDef(t, "d1")).toBeNull();

    const logs = await t.run(async (ctx) =>
      ctx.db.query("activityLogs").withIndex("by_organizationId", (q) => q.eq("organizationId", ORG)).collect(),
    );
    expect(logs.map((l) => l.action).sort()).toEqual(["CREATE", "DELETE", "UPDATE"]);
  });

  test("create rejects a duplicate fieldKey in the same org + entity type", async () => {
    const t = makeT();
    await seedMember(t);
    await t.withIdentity(asUser).mutation(api.customFieldDefinitionsWrites.createNative, {
      id: "d1", organizationId: ORG, ...baseCreate, createdAt: NOW, actor, auditId: "a1",
    });
    await expect(
      t.withIdentity(asUser).mutation(api.customFieldDefinitionsWrites.createNative, {
        id: "d2", organizationId: ORG, ...baseCreate, createdAt: NOW, actor, auditId: "a2",
      }),
    ).rejects.toThrow(/already exists/i);
  });

  test("create allows the same fieldKey under a different entity type", async () => {
    const t = makeT();
    await seedMember(t);
    await t.withIdentity(asUser).mutation(api.customFieldDefinitionsWrites.createNative, {
      id: "d1", organizationId: ORG, ...baseCreate, createdAt: NOW, actor, auditId: "a1",
    });
    await t.withIdentity(asUser).mutation(api.customFieldDefinitionsWrites.createNative, {
      id: "d2", organizationId: ORG, ...baseCreate, entityType: "KIT", createdAt: NOW, actor, auditId: "a2",
    });
    expect((await getDef(t, "d2"))?.entityType).toBe("KIT");
  });

  test("normalizes at the mutation boundary: non-SELECT clears options, blank help stores absent", async () => {
    const t = makeT();
    await seedMember(t);
    await t.withIdentity(asUser).mutation(api.customFieldDefinitionsWrites.createNative, {
      id: "d1", organizationId: ORG, ...baseCreate, fieldType: "TEXT",
      options: ["stray", "values"], helpText: "", createdAt: NOW, actor, auditId: "a1",
    });
    const doc = await getDef(t, "d1");
    expect(doc?.options).toEqual([]); // TEXT field → options cleared server-side
    expect(doc?.helpText).toBeUndefined(); // blank → absent
  });

  test("update rejects a definition in another org (no cross-tenant write)", async () => {
    const t = makeT();
    await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("customFieldDefinitions", {
        id: "dX", organizationId: OTHER, ...baseCreate, createdAt: NOW, updatedAt: NOW,
      });
    });
    await expect(
      t.withIdentity(asUser).mutation(api.customFieldDefinitionsWrites.updateNative, {
        id: "dX", orgId: ORG, label: "hijack", fieldType: "TEXT", options: [], required: false,
        sortOrder: 0, isActive: true, actor, auditId: "a9", now: NOW,
      }),
    ).rejects.toThrow(/not found/i);
    expect((await getDef(t, "dX"))?.label).toBe("Rig Number");
  });

  test("remove rejects a definition in another org", async () => {
    const t = makeT();
    await seedMember(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("customFieldDefinitions", {
        id: "dX", organizationId: OTHER, ...baseCreate, createdAt: NOW, updatedAt: NOW,
      });
    });
    await expect(
      t.withIdentity(asUser).mutation(api.customFieldDefinitionsWrites.removeNative, {
        id: "dX", orgId: ORG, actor, auditId: "a9", now: NOW,
      }),
    ).rejects.toThrow(/not found/i);
    expect(await getDef(t, "dX")).not.toBeNull();
  });

  test("rejects a member without orgSettings:update permission", async () => {
    const t = makeT();
    await seedMember(t, "viewer");
    await expect(
      t.withIdentity({ subject: USER, orgId: ORG, role: "viewer" }).mutation(
        api.customFieldDefinitionsWrites.createNative,
        { id: "d1", organizationId: ORG, ...baseCreate, createdAt: NOW, actor, auditId: "a1" },
      ),
    ).rejects.toThrow(/Forbidden|permission/i);
  });
});
