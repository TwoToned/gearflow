// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NOW, TODAY, DAY } from "@/lib/__tests__/floor-fixtures";
import { returningGroup, returningLine } from "@/lib/__tests__/returning-fixtures";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const mobile = { value: false };
const search = { value: "mode=returning" };
const replace = vi.fn((href: string) => { search.value = href.split("?")[1] ?? ""; });
const push = vi.fn((href: string) => { search.value = href.split("?")[1] ?? ""; });
const scanUndo = vi.fn(async () => {});
const checkInItems = vi.fn(async () => ({ updatedLineIds: ["l1"], autoStatus: null, scanUndo }));
const checkInKitsBatch = vi.fn(async () => ({ succeeded: [], errors: [], autoStatus: null }));
const returnBulk = vi.fn(async () => ({ distributed: 4, scanUndo }));
const correctCondition = vi.fn(async () => ({ updated: true, autoStatus: null }));
const raiseRepair = vi.fn(async () => ({ id: "r1", autoStatus: null }));
const resolve = vi.fn();

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }));
vi.mock("@/hooks/use-stable-now", () => ({ useStableNow: () => NOW }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.value),
  useRouter: () => ({ replace, push }),
  usePathname: () => "/warehouse",
}));
vi.mock("convex/react", () => ({ useConvex: () => ({ query: vi.fn() }) }));
vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org_1" } }),
  useSession: () => ({ data: { user: { id: "u1", name: "Sam" } } }),
}));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => true }));
vi.mock("@/components/scanner/camera-scanner-dialog", () => ({ CameraScannerDialog: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/hooks/use-warehouse-writes", () => ({ useWarehouseWrites: () => ({ checkInItems, checkInKitsBatch, checkInKit: vi.fn() }) }));
vi.mock("@/hooks/use-native-warehouse", () => ({ useNativeWarehouseList: () => ({ projects: [], isLoading: false }) }));

const board = {
  truncated: false,
  totals: { out: 3, back: 2, damaged: 0, missing: 0, lateBack: 0 },
  groups: [
    returningGroup({ projectId: "p1", projectNumber: "2341", projectName: "Gala", windowEnd: TODAY - 2 * DAY }, [
      returningLine({ lineItemId: "l1", description: "Shure SM58", out: 2, back: 2 }),
    ]),
    returningGroup({ projectId: "p2", projectNumber: "2342", projectName: "Tour" }, [
      returningLine({ lineItemId: "l2", description: "XLR 10m", kind: "bulk", out: 1, back: 0 }),
    ]),
  ],
};
const units = {
  windowEnd: TODAY, truncated: false,
  units: [
    { unitId: "u1", assetId: "a1", assetTag: "SK-1", quantity: 1, returnedQuantity: 0, status: "CHECKED_OUT", returnCondition: null, returnStatus: null, returnedAt: null, lateBack: false },
    { unitId: "u2", assetId: "a2", assetTag: "SK-2", quantity: 1, returnedQuantity: 1, status: "RETURNED", returnCondition: "GOOD", returnStatus: null, returnedAt: NOW, lateBack: false },
  ],
};
vi.mock("@/hooks/use-returns", () => ({
  useReturningBoard: () => ({ data: board, isLoading: false }),
  useReturningLineUnits: () => units,
  useResolveScan: () => resolve,
  useReturnsWrites: () => ({ returnBulk, correctCondition, raiseRepair }),
}));

import { FloorPage } from "@/components/warehouse/floor/floor-page";

beforeEach(() => {
  mobile.value = false;
  search.value = "mode=returning";
  vi.clearAllMocks();
});

describe("Returning mode", () => {
  it("shows the outcome strip and the lines grouped by job, late jobs flagged", () => {
    render(<FloorPage />);
    expect(screen.getByRole("toolbar", { name: "Outcome" })).toBeTruthy();
    const gala = screen.getByRole("region", { name: "#2341 Gala" });
    expect(within(gala).getByText("Shure SM58")).toBeTruthy();
    expect(within(gala).getByText(/overdue/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "#2342 Tour" })).toBeTruthy();
  });

  it("a scanned asset returns through checkInItems once, and the strip's Undo IS the toast's closure", async () => {
    resolve.mockResolvedValueOnce({ kind: "asset", assetId: "a1", assetTag: "SK-1", assetName: "SM58", lineItemId: "l1", unitId: "u1", projectId: "p1", projectNumber: "2341", projectName: "Gala" });
    render(<FloorPage />);
    await userEvent.type(screen.getByLabelText("Scan input"), "SK-1{Enter}");
    expect(await screen.findByText("SK-1 SM58 · back from #2341")).toBeTruthy();
    expect(checkInItems).toHaveBeenCalledWith("p1", [{ lineItemId: "l1", assetId: "a1", returnCondition: "GOOD" }]);
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(scanUndo).toHaveBeenCalledTimes(1);
  });

  it("Outcome ▾ on the scanned unit opens and corrects it through the one correction write", async () => {
    resolve.mockResolvedValueOnce({ kind: "asset", assetId: "a1", assetTag: "SK-1", assetName: "SM58", lineItemId: "l1", unitId: "u1", projectId: "p1", projectNumber: "2341", projectName: "Gala" });
    render(<FloorPage />);
    await userEvent.type(screen.getByLabelText("Scan input"), "SK-1{Enter}");
    await userEvent.click(await screen.findByRole("button", { name: "Outcome ▾" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Damaged" }));
    expect(correctCondition).toHaveBeenCalledWith({ lineItemId: "l1", assetId: "a1", unitId: "u1", returnCondition: "DAMAGED" }, "GOOD");
  });

  it("a bulk tag on two jobs opens Which job? and returns to the one picked", async () => {
    resolve.mockResolvedValueOnce({
      kind: "bulk_multi", bulkAssetId: "b1", assetTag: "CAB", assetName: "XLR",
      deployments: [
        { projectId: "p1", projectNumber: "2341", projectName: "Gala", outstanding: 3 },
        { projectId: "p2", projectNumber: "2342", projectName: "Tour", outstanding: 1 },
      ],
    });
    render(<FloorPage />);
    await userEvent.type(screen.getByLabelText("Scan input"), "CAB{Enter}");
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Return to #2342" }));
    expect(returnBulk).toHaveBeenCalledWith({ bulkAssetId: "b1", projectId: "p2", quantity: 1 });
  });

  it("row ⋯ opens; Show units lists the chips, and a chip's menu returns that one unit", async () => {
    render(<FloorPage />);
    await userEvent.click(screen.getByRole("button", { name: "Actions for Shure SM58" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Show units" }));
    await userEvent.click(screen.getByRole("button", { name: /SK-1 · out/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Return" }));
    expect(checkInItems).toHaveBeenCalledWith("p1", [{ lineItemId: "l1", assetId: "a1", returnCondition: "GOOD" }]);
  });

  it("ticking lines raises the BulkBar; Mark missing confirms before writing", async () => {
    render(<FloorPage />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Shure SM58" }));
    const bar = await screen.findByRole("toolbar", { name: "Bulk actions" });
    await userEvent.click(within(bar).getByRole("button", { name: "Mark missing 1" }));
    const dialog = await screen.findByRole("dialog");
    expect(checkInItems).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Mark missing" }));
    expect(checkInItems).toHaveBeenCalledWith("p1", [{ lineItemId: "l1", returnCondition: "MISSING", quantity: 2 }]);
  });

  it("the dock's Look up word goes back to the board (a history push)", async () => {
    render(<FloorPage />);
    await userEvent.click(screen.getByRole("radio", { name: "Look up" }));
    expect(push).toHaveBeenCalledWith("/warehouse", { scroll: false });
  });
});
