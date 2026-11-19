import { describe, it, expect } from "vitest";
import { planReceive, receivedText, type ReceiveResolve } from "@/lib/floor-receive";

const job = { projectId: "p1", projectNumber: "2341", projectName: "Gala" };

describe("planReceive (§9c.4): one reading per scan", () => {
  it("an asset out on one job is ONE write", () => {
    const res = { kind: "asset", assetId: "a1", assetTag: "SK-1", assetName: "SM58", lineItemId: "l1", unitId: "u1", ...job } as ReceiveResolve;
    const plan = planReceive("SK-1", res);
    expect(plan).toMatchObject({ type: "write", target: { kind: "asset", assetId: "a1", lineItemId: "l1", unitId: "u1", projectId: "p1" } });
    if (plan.type === "write") expect(receivedText(plan.target)).toBe("SK-1 SM58 · back from #2341");
  });
  it("a bulk tag on several jobs asks which job, each with what it still has out", () => {
    const res = {
      kind: "bulk_multi", bulkAssetId: "b1", assetTag: "CAB", assetName: "XLR",
      deployments: [{ ...job, outstanding: 10 }, { projectId: "p2", projectNumber: "2342", projectName: "Tour", outstanding: 4 }],
    } as ReceiveResolve;
    const plan = planReceive("CAB", res);
    expect(plan.type).toBe("choose");
    if (plan.type === "choose") expect(plan.options.map((o) => (o.kind === "bulk" ? o.quantity : 0))).toEqual([10, 4]);
  });
  it("guards and exceptions are notices that never block the dock", () => {
    expect(planReceive("X", { kind: "not_found" })).toEqual({ type: "notice", tone: "error", text: "X · not found" });
    expect(planReceive("A", { kind: "guard_kit_member", assetId: "a", assetTag: "A", assetName: "n", kitId: "k", kitAssetTag: "K-1", kitName: "Rack" } as ReceiveResolve))
      .toMatchObject({ type: "notice", tone: "warning", text: "A is in kit K-1 · scan the kit" });
    expect(planReceive("A", { kind: "exception", reason: "no_active_deployment", assetId: "a", assetTag: "A", assetName: "n" } as ReceiveResolve))
      .toMatchObject({ type: "notice", tone: "neutral", text: "A · not out on any job" });
  });
});
