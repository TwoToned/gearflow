// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  mobile: { value: false },
  params: new URLSearchParams(),
  replace: vi.fn(),
  push: vi.fn(),
  asset: null as unknown,
  perms: { all: true },
  retireMany: vi.fn(async () => ({ done: [], skipped: [] })),
  reinstateMany: vi.fn(async () => ({ done: [], skipped: [] })),
  writes: { remove: vi.fn(async () => ({ id: "a1" })), move: vi.fn(), undoUpdate: vi.fn() },
  maint: { create: vi.fn(), undoCreate: vi.fn() },
  warehouse: { forceReturnAsset: vi.fn(async () => ({ success: true })) },
}));

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => h.mobile.value }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: h.replace, push: h.push }),
  usePathname: () => "/assets/registry/a1",
  useSearchParams: () => h.params,
}));
vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { id: "org1" } }) }));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => h.perms.all }));
vi.mock("@/hooks/use-native-asset", () => ({ useNativeAsset: () => ({ data: h.asset, isLoading: false, notFound: false }) }));
vi.mock("@/hooks/use-authed-query", () => ({ useAuthedQuery: () => [] }));
vi.mock("@/hooks/use-keyboard-shortcut", () => ({ useKeyboardShortcut: () => undefined }));
vi.mock("@/hooks/use-asset-writes", () => ({ useAssetWrites: () => h.writes }));
vi.mock("@/hooks/use-maintenance-writes", () => ({ useMaintenanceWrites: () => h.maint }));
vi.mock("@/hooks/use-warehouse-writes", () => ({ useWarehouseWrites: () => h.warehouse }));
vi.mock("@/hooks/use-retire-assets", () => ({ useRetireAssets: () => ({ retireMany: h.retireMany, reinstateMany: h.reinstateMany }) }));
vi.mock("@/hooks/use-locations", () => ({ useLocations: () => [{ id: "l1", name: "Warehouse A", type: "WAREHOUSE" }, { id: "l2", name: "Warehouse B", type: "WAREHOUSE" }] }));
vi.mock("@/components/assets/detail/use-asset-scan", () => ({ useAssetScan: () => ({ scan: vi.fn() }) }));
vi.mock("@/components/scanner/camera-scanner-dialog", () => ({ CameraScannerDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Scanner" /> : null) }));
vi.mock("@/components/layout/page-meta", () => ({ PageMeta: () => null }));
vi.mock("@/components/assets/asset-sheet", () => ({ AssetSheet: ({ state }: { state: unknown }) => (state ? <div role="dialog" aria-label="Asset sheet" /> : null) }));
vi.mock("@/components/warehouse/report-issue-dialog", () => ({ ReportIssueDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Report issue" /> : null) }));
vi.mock("@/components/assets/asset-accessories-manager", () => ({ AssetAccessoriesManager: () => <div>accessories manager</div> }));
vi.mock("@/components/assets/asset-checks-tab", () => ({ AssetChecksTab: () => <div>checks tab</div> }));
vi.mock("@/components/bookings/booking-calendar", () => ({ BookingCalendar: () => <div>booking calendar</div> }));
vi.mock("@/components/custom-fields/custom-fields-display", () => ({ CustomFieldsDisplay: () => null }));
vi.mock("@/components/auth/permission-gate", () => ({ CanDo: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/activity/activity-timeline", () => ({ ActivityTimeline: () => <div>activity timeline</div> }));
vi.mock("@/components/media/media-uploader", () => ({ MediaUploader: () => <div>uploader</div> }));
vi.mock("@/components/collaboration/entity-comments-button", () => ({ EntityCommentsButton: () => <button>Open discussion</button> }));
vi.mock("@/components/ui/notes-editor", () => ({ NotesEditor: () => <div>notes editor</div> }));
vi.mock("@/hooks/use-media-writes", () => ({ useMediaWrites: () => ({}) }));
vi.mock("@/hooks/use-native-asset-writes", () => ({ useOptimisticAssetNotes: () => ({ enabled: false }) }));
vi.mock("@/components/media/media-thumbnail", () => ({ MediaThumbnail: () => null }));

import { AssetDetail } from "@/components/assets/detail/asset-detail";

const base = {
  id: "a1", organizationId: "org1", assetTag: "AURA-01", customName: null, serialNumber: "S1", status: "AVAILABLE", condition: "GOOD",
  modelId: "m1", supplierId: null, locationId: "l1", parentAssetId: null, barcode: null, notes: null, isActive: true,
  purchaseDate: null, purchasePrice: 1200, purchaseSupplier: null, warrantyExpiry: null, customFieldValues: null,
  media: [], supplier: null, parentAsset: null, location: { id: "l1", name: "Warehouse A" },
  childAssets: [], childBulkItems: [], lineItems: [], maintenanceLinks: [], testTagAsset: null, scanLogs: [],
  model: { id: "m1", name: "MAC Aura XB", manufacturer: "Martin", requiresTestAndTag: false, replacementCost: 3400, specifications: null, category: { id: "c1", name: "Lighting" }, media: [], bulkAccessories: [] },
  facts: { serviceSchedules: [], lastServiceAt: null, jobsTruncated: false, openRepairs: 0, hasPrepOrReturnCheck: false, lastCheckResult: null, lastScanAt: null, dueBackAt: null, canDelete: true, deleteBlockedBy: null, deleteBlockedText: null },
};
const withAsset = (over: Record<string, unknown> = {}, facts: Record<string, unknown> = {}) => {
  h.asset = { ...base, ...over, facts: { ...base.facts, ...facts } };
};

describe("AssetDetail", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    h.mobile.value = false;
    h.params = new URLSearchParams();
    h.perms.all = true;
    withAsset();
  });

  it("opens on Overview: a dot-word header, the health verdict with unchecked rows, and Now · Last scan · Value", () => {
    render(<AssetDetail id="a1" />);
    expect(screen.getByRole("heading", { level: 1, name: "AURA-01" })).toBeTruthy();
    expect(screen.getByText("Available")).toBeTruthy();
    // nothing has ever been checked, so it is never "Ready to go"
    expect(screen.getByRole("heading", { name: "Nearly ready" })).toBeTruthy();
    expect(screen.getByText(/checks clear/)).toBeTruthy();
    expect(screen.getByText("Condition not checked")).toBeTruthy();
    expect(screen.getByText("Now")).toBeTruthy();
    expect(screen.getByText("No scan on record")).toBeTruthy();
    expect(screen.getByText("Replacement")).toBeTruthy();
    // Overview has no rail: the facts are not printed twice
    expect(screen.queryByLabelText("Asset facts")).toBeNull();
  });

  it("a tab is controlled by ?tab=; any other tab shows the rail, and a click writes the URL", async () => {
    h.params = new URLSearchParams("tab=history");
    render(<AssetDetail id="a1" />);
    expect(screen.getByRole("tab", { name: /History/, selected: true })).toBeTruthy();
    expect(screen.getByLabelText("Asset facts")).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: /Checks/ }));
    expect(h.replace).toHaveBeenCalledWith("/assets/registry/a1?tab=checks", { scroll: false });
    cleanup();
    h.params = new URLSearchParams("tab=nonsense");
    render(<AssetDetail id="a1" />);
    expect(screen.getByRole("tab", { name: /Overview/, selected: true })).toBeTruthy();
  });

  it("the ⋯ menu OPENS: Scan first, Retire last; Force return is absent unless deployed", async () => {
    render(<AssetDetail id="a1" />);
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    const items = await screen.findAllByRole("menuitem");
    const names = items.map((i) => i.textContent ?? "");
    expect(names[0]).toContain("Scan a tag…");
    expect(names.at(-1)).toContain("Retire…");
    expect(names.some((n) => n.includes("Force return"))).toBe(false);
    expect(names.some((n) => n.includes("Delete"))).toBe(false);
    for (const want of ["Move to…", "Schedule service…", "New asset like this…", "Report issue…", "Print label…"]) {
      expect(names.some((n) => n.includes(want)), want).toBe(true);
    }
  });

  it("a deployed unit offers Force return, and its dialog opens", async () => {
    withAsset({ status: "CHECKED_OUT", lineItems: [{ id: "li1", projectId: "p1", type: "EQUIPMENT", status: "CHECKED_OUT", checkedOutAt: null, returnedAt: null, project: { name: "Hilton gala", projectNumber: "#2341" } }] });
    render(<AssetDetail id="a1" />);
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Force return/ }));
    expect(await screen.findByText("Force return AURA-01?")).toBeTruthy();
    expect(screen.getByText("Hilton gala")).toBeTruthy();
  });

  it("Retire opens a dialog that names what it does; Delete is inside it only for a unit with no history", async () => {
    render(<AssetDetail id="a1" />);
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Retire/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Retire AURA-01?")).toBeTruthy();
    expect(within(dialog).getByText(/test & tag schedule is retired/)).toBeTruthy();
    // a bare unit: Delete is a second, explicit step inside the dialog
    await userEvent.click(within(dialog).getByRole("button", { name: /Delete permanently instead/ }));
    expect(within(dialog).getByText("Delete AURA-01 permanently?")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete AURA-01" }));
    await waitFor(() => expect(h.writes.remove).toHaveBeenCalledWith("a1"));
    expect(h.push).toHaveBeenCalledWith("/assets/registry");
  });

  it("a unit WITH history has no Delete anywhere (absent, not disabled), and Retire runs the shared closure", async () => {
    withAsset({}, { canDelete: false, deleteBlockedBy: "SCAN", deleteBlockedText: "it has scan history" });
    render(<AssetDetail id="a1" />);
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Retire/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText(/Delete/)).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Retire AURA-01" }));
    await waitFor(() => expect(h.retireMany).toHaveBeenCalledTimes(1));
    expect((h.retireMany.mock.calls[0] as unknown[])[0]).toEqual([{ id: "a1", tag: "AURA-01", kind: "serialized", status: "AVAILABLE" }]);
  });

  it("a retired unit offers Reinstate, not Retire", async () => {
    withAsset({ status: "RETIRED", isActive: false });
    render(<AssetDetail id="a1" />);
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(await screen.findByRole("menuitem", { name: /Reinstate/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Retire/ })).toBeNull();
  });

  it("Move, Schedule service and Print label dialogs open", async () => {
    render(<AssetDetail id="a1" />);
    for (const [item, title] of [["Move to…", "Move AURA-01"], ["Schedule service…", "Schedule a service for AURA-01"], ["Print label…", "Label for AURA-01"]] as const) {
      await userEvent.click(screen.getByRole("button", { name: "More actions" }));
      await userEvent.click(await screen.findByRole("menuitem", { name: item }));
      expect(await screen.findByText(title)).toBeTruthy();
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByText(title)).toBeNull());
    }
  });

  it("phone: Scan is the sticky primary, and it opens the camera dialog from the tap", async () => {
    h.mobile.value = true;
    render(<AssetDetail id="a1" />);
    await userEvent.click(screen.getByRole("button", { name: "Scan" }));
    expect(await screen.findByRole("dialog", { name: "Scanner" })).toBeTruthy();
  });

  it("?edit=1 opens the edit sheet; without update permission it does not", () => {
    h.params = new URLSearchParams("edit=1");
    render(<AssetDetail id="a1" />);
    expect(screen.getByRole("dialog", { name: "Asset sheet" })).toBeTruthy();
    cleanup();
    h.perms.all = false;
    render(<AssetDetail id="a1" />);
    expect(screen.queryByRole("dialog", { name: "Asset sheet" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("cost is not printed when it was not sent (a noFinancials key)", () => {
    withAsset({ purchasePrice: null, model: { ...base.model, replacementCost: null } });
    render(<AssetDetail id="a1" />);
    expect(screen.queryByText("Replacement")).toBeNull();
    expect(screen.queryByText("Cost")).toBeNull();
  });
});
