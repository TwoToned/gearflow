import { describe, it, expect } from "vitest";
import { classifyScan, type ScanLookup, type ScanContext } from "./warehouse-scan-classify";

const ctx: ScanContext = {
  containersByTag: new Map([["CASE-1", { id: "c1", label: "LX-04" }]]),
  batchKeys: new Set(["l1:a1"]),
  kitOnJob: (id) => id === "k1",
};
const run = (r: ScanLookup | null, stage: "pick" | "prepped" | "out" | "returned" = "pick", raw = "X") => classifyScan(raw, r, stage, ctx);
const text = (p: ReturnType<typeof run>) => (p.kind === "refuse" ? `${p.tone}|${p.text}` : p.kind);

describe("classifyScan: legacy branch table", () => {
  it("case tag makes the case active, before any lookup", () => {
    expect(run(null, "pick", "CASE-1")).toEqual({ kind: "setCase", containerId: "c1", label: "LX-04" });
  });
  it("unknown tag", () => expect(text(run({ found: false }))).toBe("warning|Asset not found"));
  it("kit ok / not on job / already out / other", () => {
    expect(run({ found: true, type: "kit", kitId: "k1", lineItemId: "l9", assetName: "Rack" }).kind).toBe("kit");
    expect(text(run({ found: true, type: "kit", reason: "not_on_project" }))).toBe("error|Kit not assigned to this job");
    expect(text(run({ found: true, type: "kit", reason: "already_checked_out" }))).toBe("error|Kit already deployed");
    expect(text(run({ found: true, type: "kit", reason: "not_checked_out" }))).toBe("error|Cannot prep this kit");
  });
  it("kit member verifies when its kit is on the job, else errors", () => {
    expect(run({ found: true, type: "kit_member", kitId: "k1", assetId: "a" }).kind).toBe("verifyKitMember");
    expect(text(run({ found: true, type: "kit_member", kitId: "k2", assetId: "a", kitAssetTag: "K-2" }))).toBe("error|This asset is in a kit (K-2) not on this job.");
  });
  it("accessory scan says scan the parent", () => {
    expect(text(run({ found: true, type: "asset_child", assetName: "Batt", parentAssetTag: "P-1" })))
      .toBe("warning|Batt is an accessory of P-1 — scan the parent; accessories move with it.");
  });
  it("on-job unit acts; a unit already in the prep batch is a duplicate", () => {
    expect(run({ found: true, type: "serialized", lineItemId: "l2", assetId: "a2", assetName: "SM58" }).kind).toBe("act");
    expect(run({ found: true, type: "serialized", lineItemId: "l1", assetId: "a1", assetName: "SM58" }).kind).toBe("duplicate");
    expect(run({ found: true, type: "serialized", lineItemId: "l1", assetId: "a1" }, "prepped").kind).toBe("act");
  });
  it("foreign tag offers add", () => {
    const p = run({ found: true, type: "serialized", reason: "not_on_project", modelId: "m", assetId: "a", assetName: "X" });
    expect(p).toMatchObject({ kind: "offerAdd", modelId: "m", assetId: "a" });
  });
  it.each([
    ["already_checked_out", "error|Already deployed on this job"],
    ["asset_checked_out_elsewhere", "error|Already deployed"],
    ["not_on_project", "error|Asset not assigned to this job"],
    ["not_checked_out", "error|Asset is not deployed on this job"],
    ["already_returned", "warning|All units already returned"],
    ["nonsense", "error|Cannot deploy this asset"],
  ])("reason %s", (reason, want) => expect(text(run({ found: true, type: "serialized", reason }))).toBe(want));
  it("asset unavailable and tt_blocked", () => {
    expect(text(run({ found: true, type: "serialized", reason: "asset_unavailable", assetStatus: "IN_REPAIR" }))).toBe("error|Asset is in repair cannot be deployed".replace("in repair cannot", "in repair and cannot"));
    expect(text(run({ found: true, type: "serialized", reason: "tt_blocked", ttStatus: "FAILED" }))).toBe("error|Test & Tag failed. Cannot deploy until tested.");
  });
  it("later stages fall back to their own verb", () => {
    expect(text(run({ found: true, type: "serialized", reason: "zzz" }, "out"))).toBe("error|Cannot return this asset");
  });
});
