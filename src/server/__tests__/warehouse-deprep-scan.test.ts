import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  lines: [] as Array<Record<string, unknown>>,
  units: [] as Array<Record<string, unknown>>,
  asset: null as Record<string, unknown> | null,
  bulk: null as Record<string, unknown> | null,
  kit: null as Record<string, unknown> | null,
  denied: false,
  asked: [] as string[],
}));

vi.mock("@/lib/org-context", () => ({
  requirePermission: async (resource: string, action: string) => {
    if (h.denied) throw new Error(`Forbidden: ${resource}:${action}`);
    h.asked.push(`${resource}:${action}`);
    return { organizationId: "org1" };
  },
}));
vi.mock("@/lib/serialize", () => ({ serialize: <T,>(v: T) => v }));
vi.mock("@/lib/kits-read", () => ({ getKitByAssetTag: async () => h.kit }));
vi.mock("@/lib/assets-read", () => ({ getAssetByAssetTag: async () => h.asset, getBulkAssetByAssetTag: async () => h.bulk }));
vi.mock("@/lib/models-read", () => ({ getModelById: async () => ({ name: "Model" }) }));
vi.mock("@/lib/convex-client", () => ({
  getConvexClient: async () => ({ query: async (fn: { name: string }, args: Record<string, unknown>) => (String(fn).includes("listByProject") || fn.name === "listByProject" ? h.lines : h.units.filter((u) => !args.assetId || u.assetId === args.assetId)) }),
}));
vi.mock("../../../convex/_generated/api", () => ({
  api: { projectLineItems: { listByProject: { name: "listByProject" } }, projectLineItemUnits: { listByOrgAndAsset: { name: "units" }, listByLineItem: { name: "units" } } },
}));

import { lookupDeprepScan } from "../warehouse-deprep-scan";

const waiting = { status: "RETURNED", prepStatus: "PACKED" };
beforeEach(() => { h.lines = []; h.units = []; h.asset = null; h.bulk = null; h.kit = null; h.denied = false; h.asked = []; });

describe("lookupDeprepScan is gated and org-scoped", () => {
  it("needs the same warehouse permission as the de-prep write; a role without it is rejected", async () => {
    h.asset = { id: "a1", assetTag: "T1", modelId: "m" };
    h.lines = [{ id: "L1", status: "RETURNED" }];
    await lookupDeprepScan("p", "T1");
    expect(h.asked).toEqual(["warehouse:check_out"]);
    h.denied = true;
    await expect(lookupDeprepScan("p", "T1")).rejects.toThrow(/Forbidden/);
  });
  it("a project outside the caller's org (no lines come back) resolves nothing", async () => {
    h.asset = { id: "a1", assetTag: "T1", modelId: "m" };
    h.units = [{ id: "u1", lineItemId: "L1", assetId: "a1", ...waiting }];
    h.lines = [];
    expect(await lookupDeprepScan("foreign", "T1")).toMatchObject({ kind: "refuse" });
  });
  it("a bin scan never matches a SERIALISED line of the same model", async () => {
    h.bulk = { id: "b1", assetTag: "B1", modelId: "m" };
    h.lines = [{ id: "SL", modelId: "m", status: "RETURNED", prepStatus: "PACKED" }]; // serial line, model-level, no bulkAssetId
    h.units = [{ id: "s1", lineItemId: "SL", assetId: "a1", quantity: 1, ...waiting }, { id: "s2", lineItemId: "SL", assetId: "a2", quantity: 1, ...waiting }];
    expect(await lookupDeprepScan("p", "B1")).toMatchObject({ kind: "refuse" });
  });
  it("the waiting count only counts units of THIS bin", async () => {
    h.bulk = { id: "b1", assetTag: "B1", modelId: "m" };
    h.lines = [{ id: "ML", modelId: "m" }];
    h.units = [{ id: "u1", lineItemId: "ML", bulkAssetId: "b1", quantity: 4, ...waiting }, { id: "u2", lineItemId: "ML", assetId: "a9", quantity: 1, ...waiting }];
    expect(await lookupDeprepScan("p", "B1")).toMatchObject({ kind: "bulk", lineItemId: "ML", remaining: 4 });
  });
});

describe("lookupDeprepScan validates on the server", () => {
  it("an unknown tag is not found", async () => {
    expect(await lookupDeprepScan("p", "NOPE")).toEqual({ kind: "none" });
  });
  it("a serialised unit that is returned-and-packed resolves to that one unit", async () => {
    h.asset = { id: "a1", assetTag: "T1", modelId: "m" };
    h.lines = [{ id: "L1", status: "RETURNED" }];
    h.units = [{ id: "u1", lineItemId: "L1", assetId: "a1", ...waiting }];
    expect(await lookupDeprepScan("p", "T1")).toMatchObject({ kind: "unit", lineItemId: "L1", assetId: "a1" });
  });
  it("a unit that is not waiting (still out, or already de-prepped) is refused, not guessed", async () => {
    h.asset = { id: "a1", assetTag: "T1", modelId: "m" };
    h.lines = [{ id: "L1" }];
    h.units = [{ id: "u1", lineItemId: "L1", assetId: "a1", status: "CHECKED_OUT", prepStatus: "PACKED" }];
    expect(await lookupDeprepScan("p", "T1")).toMatchObject({ kind: "refuse" });
  });
  it("a tag on another job's unit (line not on this project) is refused", async () => {
    h.asset = { id: "a1", assetTag: "T1", modelId: "m" };
    h.lines = [{ id: "L1" }];
    h.units = [{ id: "u9", lineItemId: "OTHER", assetId: "a1", ...waiting }];
    expect(await lookupDeprepScan("p", "T1")).toMatchObject({ kind: "refuse" });
  });
  it("an accessory unit resolves to the unit-level DEPREP target", async () => {
    h.asset = { id: "c1", assetTag: "C1", modelId: "m" };
    h.lines = [{ id: "ACC", childKind: "ACCESSORY" }];
    h.units = [{ id: "uAcc", lineItemId: "ACC", assetId: "c1", ...waiting }];
    expect(await lookupDeprepScan("p", "C1")).toMatchObject({ kind: "accessory", unitId: "uAcc" });
  });
  it("a kit member is sent to its kit", async () => {
    h.asset = { id: "a1", assetTag: "T1", modelId: "m", kitId: "k" };
    expect(await lookupDeprepScan("p", "T1")).toMatchObject({ kind: "refuse" });
  });
  it("a kit that is returned-and-packed goes whole; one still out is refused", async () => {
    h.kit = { id: "k", name: "Kit", assetTag: "K" };
    h.lines = [{ id: "KL", kitId: "k", ...waiting }];
    expect(await lookupDeprepScan("p", "K")).toMatchObject({ kind: "kit", lineItemId: "KL" });
    h.lines = [{ id: "KL", kitId: "k", status: "CHECKED_OUT", prepStatus: "PACKED" }];
    expect(await lookupDeprepScan("p", "K")).toMatchObject({ kind: "refuse" });
  });
  it("a bulk bin reports the waiting count for the packer to confirm (D8)", async () => {
    h.bulk = { id: "b1", assetTag: "B1", modelId: "m" };
    h.lines = [{ id: "BL", bulkAssetId: "b1" }];
    h.units = [{ id: "u1", lineItemId: "BL", bulkAssetId: "b1", quantity: 7, ...waiting }, { id: "u2", lineItemId: "BL", quantity: 3, status: "CHECKED_OUT", prepStatus: "PACKED" }];
    expect(await lookupDeprepScan("p", "B1")).toMatchObject({ kind: "bulk", lineItemId: "BL", remaining: 7 });
  });
});
