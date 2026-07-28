import { describe, expect, test } from "vitest";
import { injectedArgNames, isCreateShapedFn, normalizeArgs } from "./arg-normalizer";

const baseCtx = (overrides: Partial<Parameters<typeof normalizeArgs>[1]> = {}) => ({
  operation: "assetWrites.updateNative",
  fn: "updateNative",
  kind: "mutation" as const,
  argNames: new Set(["id", "orgId", "set", "clear", "actor", "auditId", "now"]),
  actor: { userId: "u1", userName: "Ada" },
  organizationId: "org_A",
  idempotencyKey: "idem-key-12345",
  nowMs: 1_700_000_000_000,
  hasScope: () => false,
  ...overrides,
});

describe("isCreateShapedFn", () => {
  test("create*/add* mint a new row", () => {
    expect(isCreateShapedFn("createNative")).toBe(true);
    expect(isCreateShapedFn("createIfMissing")).toBe(true);
    expect(isCreateShapedFn("addNative")).toBe(true);
    expect(isCreateShapedFn("addSupplierOrderItemNative")).toBe(true);
  });

  test("update/remove/delete/archive/patch/get do not", () => {
    for (const fn of ["updateNative", "removeNative", "deleteNative", "archiveNative", "patchNative", "getById", "list"]) {
      expect(isCreateShapedFn(fn)).toBe(false);
    }
  });
});

describe("injectedArgNames", () => {
  test("id is injected only for a create-shaped fn", () => {
    const argNames = new Set(["id", "orgId", "actor", "auditId", "now"]);
    expect(injectedArgNames(argNames, "createNative").has("id")).toBe(true);
    expect(injectedArgNames(argNames, "updateNative").has("id")).toBe(false);
  });

  test("auditId, actor, now, orgId, organizationId are always injected when present", () => {
    const argNames = new Set(["auditId", "actor", "now", "orgId", "organizationId"]);
    const injected = injectedArgNames(argNames, "updateNative");
    expect([...injected].sort()).toEqual(["actor", "auditId", "now", "orgId", "organizationId"]);
  });

  test("set/clear are NOT injected — allowOverbook is forced, not stripped", () => {
    const argNames = new Set(["set", "clear", "allowOverbook"]);
    const injected = injectedArgNames(argNames, "updateNative");
    expect(injected.size).toBe(0);
  });
});

describe("normalizeArgs — actor/org injection (R-9.3)", () => {
  test("actor is always overwritten from the key context, never trusted from the caller", () => {
    const out = normalizeArgs({ actor: { userId: "attacker", userName: "Evil" }, id: "a1", orgId: "org_A", set: {}, clear: [] }, baseCtx());
    expect(out.actor).toEqual({ userId: "u1", userName: "Ada" });
  });

  test("orgId is overwritten even when the caller names a different org", () => {
    const out = normalizeArgs({ orgId: "org_B_attacker", id: "a1", set: {}, clear: [] }, baseCtx());
    expect(out.orgId).toBe("org_A");
  });

  test("organizationId is overwritten too, for operations that use that name instead", () => {
    const ctx = baseCtx({ argNames: new Set(["organizationId", "auditId"]) });
    const out = normalizeArgs({ organizationId: "org_B_attacker" }, ctx);
    expect(out.organizationId).toBe("org_A");
  });
});

describe("normalizeArgs — id/auditId derivation", () => {
  test("auditId is derived deterministically from the idempotency key", () => {
    const out1 = normalizeArgs({ id: "a1", orgId: "org_A", set: {}, clear: [] }, baseCtx());
    const out2 = normalizeArgs({ id: "a1", orgId: "org_A", set: {}, clear: [] }, baseCtx());
    expect(out1.auditId).toBe(out2.auditId);
    expect(typeof out1.auditId).toBe("string");
  });

  test("id is left untouched (caller-supplied) on a non-create-shaped op", () => {
    const out = normalizeArgs({ id: "existing-asset-id", orgId: "org_A", set: {}, clear: [] }, baseCtx());
    expect(out.id).toBe("existing-asset-id");
  });

  test("id IS derived from the idempotency key on a create-shaped op", () => {
    const ctx = baseCtx({ operation: "assetWrites.createNative", fn: "createNative", argNames: new Set(["id", "orgId", "actor", "auditId", "now"]) });
    const out = normalizeArgs({ id: "caller-supplied-ignored", orgId: "org_A" }, ctx);
    expect(out.id).not.toBe("caller-supplied-ignored");
    expect(typeof out.id).toBe("string");
  });

  test("throws a clear error when auditId is required but no idempotency key was supplied", () => {
    const ctx = baseCtx({ idempotencyKey: null });
    expect(() => normalizeArgs({ id: "a1", orgId: "org_A", set: {}, clear: [] }, ctx)).toThrow(/idempotencyKey is required/i);
  });
});

describe("normalizeArgs — now/emitSideEffects/allowOverbook", () => {
  test("now is the server clock, not caller-supplied", () => {
    const ctx = baseCtx({ argNames: new Set(["now"]), nowMs: 42 });
    const out = normalizeArgs({ now: 999_999 }, ctx);
    expect(out.now).toBe(42);
  });

  test("emitSideEffects is forced true", () => {
    const ctx = baseCtx({ argNames: new Set(["emitSideEffects"]) });
    expect(normalizeArgs({ emitSideEffects: false }, ctx).emitSideEffects).toBe(true);
    expect(normalizeArgs({}, ctx).emitSideEffects).toBe(true);
  });

  test("allowOverbook is forced false without the project:allow_overbook scope", () => {
    const ctx = baseCtx({ argNames: new Set(["allowOverbook"]), hasScope: () => false });
    expect(normalizeArgs({ allowOverbook: true }, ctx).allowOverbook).toBe(false);
  });

  test("allowOverbook is honoured true only with the scope", () => {
    const ctx = baseCtx({
      argNames: new Set(["allowOverbook"]),
      hasScope: (resource, action) => resource === "project" && action === "allow_overbook",
    });
    expect(normalizeArgs({ allowOverbook: true }, ctx).allowOverbook).toBe(true);
  });

  test("allowOverbook stays false if the caller didn't even ask for it, scope or not", () => {
    const ctx = baseCtx({ argNames: new Set(["allowOverbook"]), hasScope: () => true });
    expect(normalizeArgs({}, ctx).allowOverbook).toBe(false);
  });
});

describe("normalizeArgs — set/clear split", () => {
  test("null and empty-string values move from set into clear", () => {
    const out = normalizeArgs(
      { id: "a1", orgId: "org_A", set: { assetTag: "NEW-1", notes: null, customName: "" } },
      baseCtx(),
    );
    expect(out.set).toEqual({ assetTag: "NEW-1" });
    expect(out.clear).toEqual(expect.arrayContaining(["notes", "customName"]));
    expect((out.clear as string[]).length).toBe(2);
  });

  test("a missing set object produces an empty set with no clears", () => {
    const out = normalizeArgs({ id: "a1", orgId: "org_A" }, baseCtx());
    expect(out.set).toEqual({});
    expect(out.clear).toEqual([]);
  });

  test("clear entries never duplicate", () => {
    const out = normalizeArgs({ id: "a1", orgId: "org_A", set: { notes: null }, clear: ["notes"] }, baseCtx());
    expect(out.clear).toEqual(["notes"]);
  });
});
