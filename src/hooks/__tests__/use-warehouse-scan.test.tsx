// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWarehouseScan, type WarehouseScanDeps } from "@/hooks/use-warehouse-scan";

function setup(over: Partial<WarehouseScanDeps> = {}) {
  const undo = vi.fn();
  const deps: WarehouseScanDeps = {
    stage: "pick",
    mode: "prep",
    lookup: vi.fn().mockResolvedValue({ found: true, type: "serialized", lineItemId: "l1", assetId: "a1", assetName: "SM58" }),
    context: () => ({ containersByTag: new Map([["CASE-1", { id: "c1", label: "LX-04" }]]) }),
    setCase: vi.fn(),
    verifyKitMember: vi.fn(),
    actKit: vi.fn().mockResolvedValue({ text: "Kit prepped" }),
    act: vi.fn().mockResolvedValue({ text: "Prepped SM58", undo }),
    describe: vi.fn().mockReturnValue({ text: "SM58 · Needs check", tone: "warning", action: { label: "Run check", onSelect: vi.fn() } }),
    addAndAct: vi.fn().mockResolvedValue({ text: "Added and prepped" }),
    play: vi.fn(),
    ...over,
  };
  const hook = renderHook(() => useWarehouseScan(deps));
  return { deps, undo, hook };
}

describe("useWarehouseScan: one pipeline", () => {
  it("a unit on the job acts, and the strip undo IS the writer's closure", async () => {
    const { deps, undo, hook } = setup();
    await act(async () => { await hook.result.current.scan(" SM-1 "); });
    expect(deps.lookup).toHaveBeenCalledWith("SM-1", "pick");
    expect(hook.result.current.entries[0]).toMatchObject({ tone: "success", text: "Prepped SM58" });
    expect(hook.result.current.entries[0].undo).toBe(undo);
    expect(deps.play).toHaveBeenCalledWith("success");
  });
  it("a case tag sets the active case without a lookup", async () => {
    const { deps, hook } = setup();
    await act(async () => { await hook.result.current.scan("CASE-1"); });
    expect(deps.setCase).toHaveBeenCalledWith("c1");
    expect(deps.lookup).not.toHaveBeenCalled();
    expect(hook.result.current.entries[0].text).toBe("Active case: LX-04");
  });
  it("check mode never writes: it describes with a Run check action", async () => {
    const { deps, hook } = setup({ mode: "check" });
    await act(async () => { await hook.result.current.scan("SM-1"); });
    expect(deps.act).not.toHaveBeenCalled();
    expect(hook.result.current.entries[0]).toMatchObject({ tone: "warning", action: { label: "Run check" } });
  });
  it("a failed write is an error entry in the same tick, never silent", async () => {
    const { hook } = setup({ act: vi.fn().mockRejectedValue(new Error("Item is not prepped")) });
    await act(async () => { await hook.result.current.scan("SM-1"); });
    expect(hook.result.current.entries[0]).toMatchObject({ tone: "error", text: "Item is not prepped" });
  });
  it("offline lookup failure is a neutral entry", async () => {
    const { hook } = setup({ lookup: vi.fn().mockRejectedValue(new TypeError("fetch")), isOffline: () => true });
    await act(async () => { await hook.result.current.scan("SM-1"); });
    expect(hook.result.current.entries[0]).toMatchObject({ tone: "neutral", text: "SM-1 not saved — needs signal" });
  });
  it("a foreign tag offers Add & prep, which writes through the same guard", async () => {
    const { deps, hook } = setup({ lookup: vi.fn().mockResolvedValue({ found: true, type: "serialized", reason: "not_on_project", modelId: "m", assetName: "X" }) });
    await act(async () => { await hook.result.current.scan("X-1"); });
    const e = hook.result.current.entries[0];
    expect(e).toMatchObject({ tone: "error", action: { label: "Add & prep" } });
    await act(async () => { await e.action!.onSelect(); });
    expect(deps.addAndAct).toHaveBeenCalled();
    expect(hook.result.current.entries[0].text).toBe("Added and prepped");
  });
  it("keeps the last five, newest first", async () => {
    const { hook } = setup();
    for (let i = 0; i < 7; i++) await act(async () => { await hook.result.current.scan(`T${i}`); });
    expect(hook.result.current.entries).toHaveLength(5);
  });
});
