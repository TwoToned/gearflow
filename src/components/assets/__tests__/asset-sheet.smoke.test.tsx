// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  writes: { create: vi.fn(), update: vi.fn(), undoUpdate: vi.fn(), remove: vi.fn() },
  bulk: { create: vi.fn(), update: vi.fn(), undoUpdate: vi.fn(), remove: vi.fn() },
  tagTaken: vi.fn(),
  announced: [] as { title: string; performUndo?: () => Promise<unknown> }[],
  push: vi.fn(),
}));

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { id: "org1" } }) }));
vi.mock("@/hooks/use-asset-writes", () => ({ useAssetWrites: () => h.writes }));
vi.mock("@/hooks/use-bulk-asset-writes", () => ({ useBulkAssetWrites: () => h.bulk }));
vi.mock("@/hooks/use-activation-milestones", () => ({ useActivationMilestones: () => undefined }));
vi.mock("@/server/settings", () => ({ peekNextAssetTags: vi.fn(async () => ["AURA-04"]) }));
vi.mock("@/components/assets/use-tag-taken", () => ({ useTagTaken: () => h.tagTaken }));
vi.mock("@/components/assets/use-asset-sheet-lookups", () => ({
  useAssetSheetLookups: () => ({
    models: [{ id: "m1", name: "MAC Aura XB", manufacturer: "Martin", modelNumber: "AURA" }],
    locations: [{ id: "l1", name: "Warehouse A", type: "WAREHOUSE", parent: null }],
    suppliers: [],
    orgTags: [],
    supplierOrders: [],
  }),
}));
vi.mock("@/lib/list-write-toast", () => ({
  announceListWrite: (a: { title: string; performUndo?: () => Promise<unknown> }) => {
    h.announced.push(a);
    return undefined;
  },
}));
vi.mock("@/components/custom-fields/custom-fields-input", () => ({ CustomFieldsInput: () => null }));
vi.mock("@/components/assets/quick-create-location", () => ({ QuickCreateLocation: () => null }));
vi.mock("@/components/assets/quick-create-supplier", () => ({ QuickCreateSupplier: () => null }));
vi.mock("@/components/assets/quick-create-supplier-order", () => ({ QuickCreateSupplierOrder: () => null }));

import { AssetSheet, type AssetSheetState } from "@/components/assets/asset-sheet";

const editState: AssetSheetState = {
  mode: "edit",
  kind: "serialized",
  values: { id: "a1", modelId: "m1", assetTag: "AURA-01", serialNumber: "S1", customName: "", status: "AVAILABLE", condition: "GOOD", notes: "keep me", locationId: "l1", isActive: true, images: [], tags: [] },
};

function open(state: AssetSheetState, props: Partial<React.ComponentProps<typeof AssetSheet>> = {}) {
  const onClose = vi.fn();
  render(<AssetSheet state={state} onClose={onClose} {...props} />);
  return { onClose };
}

describe("AssetSheet", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    h.announced.length = 0;
    h.tagTaken.mockResolvedValue(null);
    h.writes.create.mockResolvedValue({ id: "new1" });
    h.writes.update.mockResolvedValue({ id: "a1", undoable: true, auditId: "aud1" });
    h.writes.undoUpdate.mockResolvedValue({ restored: [] });
    h.writes.remove.mockResolvedValue({ id: "new1" });
    h.bulk.create.mockResolvedValue({ id: "b1" });
  });

  it("opens in edit with the record's values; Save writes one update and the toast's Undo reverses exactly it", async () => {
    const { onClose } = open(editState);
    expect(screen.getByRole("dialog", { name: "Edit AURA-01" })).toBeTruthy();
    expect((screen.getByPlaceholderText("Serial number") as HTMLInputElement).value).toBe("S1");
    await userEvent.type(screen.getByPlaceholderText("Serial number"), "9");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.writes.update).toHaveBeenCalledTimes(1));
    // the notes the Notes tab owns ride along unchanged, never cleared by an edit
    expect(h.writes.update.mock.calls[0][1]).toMatchObject({ notes: "keep me", serialNumber: "S19", assetTag: "AURA-01" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(h.announced[0].title).toBe("Saved AURA-01");
    await h.announced[0].performUndo!();
    expect(h.writes.undoUpdate).toHaveBeenCalledWith("a1", "aud1");
  });

  it("an edit that changes nothing says so and offers no Undo", async () => {
    h.writes.update.mockResolvedValue({ id: "a1", undoable: false, auditId: "aud1" });
    open(editState);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.announced[0]?.title).toBe("Nothing changed on AURA-01"));
    expect(h.announced[0].performUndo).toBeUndefined();
  });

  it("shows the inline errors under the fields: a required tag, then a taken tag (and Save writes nothing)", async () => {
    open(editState);
    const tag = screen.getByPlaceholderText("Asset tag");
    await userEvent.clear(tag);
    await userEvent.tab();
    expect(await screen.findByText("Asset tag is required")).toBeTruthy();

    h.tagTaken.mockResolvedValue("AURA-03 is already used by another asset");
    await userEvent.type(tag, "AURA-03");
    await userEvent.tab();
    expect(await screen.findByText("AURA-03 is already used by another asset")).toBeTruthy();
    // and Save refuses to write while it is taken
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.tagTaken).toHaveBeenCalled());
    expect(h.writes.update).not.toHaveBeenCalled();
  });

  it("create: the Serialised unit · Bulk stock words, the next tag, Save and add another keeps model + location and clears the serial", async () => {
    open({ mode: "create", kind: "serialized", defaults: { modelId: "m1", locationId: "l1" } });
    expect(screen.getByRole("dialog", { name: "New asset" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Serialised unit" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Bulk stock" })).toBeTruthy();
    await waitFor(() => expect((screen.getByPlaceholderText("Asset tag") as HTMLInputElement).value).toBe("AURA-04"));

    await userEvent.type(screen.getByPlaceholderText("Serial number"), "SN-9");
    await userEvent.click(screen.getByRole("button", { name: "Save and add another" }));
    await waitFor(() => expect(h.writes.create).toHaveBeenCalledTimes(1));
    expect(h.writes.create.mock.calls[0][0]).toMatchObject({ modelId: "m1", locationId: "l1", assetTag: "AURA-04", serialNumber: "SN-9" });
    // the sheet stays open on a fresh sibling: serial cleared, tag advanced (the mocked peek returns the next one)
    await waitFor(() => expect((screen.getByPlaceholderText("Serial number") as HTMLInputElement).value).toBe(""));
    expect(screen.getByRole("dialog", { name: "New asset" })).toBeTruthy();
    // create's Undo removes exactly the unit it made
    await h.announced[0].performUndo!();
    expect(h.writes.remove).toHaveBeenCalledWith("new1");
  });

  it("the words switch a create to Bulk stock (D63)", async () => {
    open({ mode: "create", kind: "serialized" });
    await userEvent.click(screen.getByRole("button", { name: "Bulk stock" }));
    expect(screen.getByRole("dialog", { name: "New bulk stock" })).toBeTruthy();
    expect(screen.getByLabelText(/Total quantity/)).toBeTruthy();
    expect(screen.getByText("Stock code", { exact: false })).toBeTruthy();
  });

  it("bulk create needs at least one on hand", async () => {
    open({ mode: "create", kind: "bulk", defaults: { modelId: "m1" } });
    await waitFor(() => expect((screen.getByPlaceholderText("e.g. AV-SM57") as HTMLInputElement).value).toBe("AURA-04"));
    await userEvent.type(screen.getByLabelText(/Total quantity/), "0");
    await userEvent.click(screen.getByRole("button", { name: "Create stock" }));
    expect(await screen.findByText("Quantity must be at least 1")).toBeTruthy();
    expect(h.bulk.create).not.toHaveBeenCalled();
  });

  it("a Radix picker works inside the open sheet (no Base UI popup in a Radix dialog)", async () => {
    open({ mode: "create", kind: "serialized" });
    await userEvent.click(screen.getByRole("button", { name: "Select a model…" }));
    await userEvent.click(await screen.findByText("Martin MAC Aura XB"));
    // the pick landed in the form: the trigger now names the model
    await waitFor(() => expect(screen.getByRole("button", { name: "Martin MAC Aura XB" })).toBeTruthy());
  });

  it("Esc with unsaved changes asks to discard; a clean sheet closes straight away", async () => {
    const { onClose } = open(editState);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
    const { onClose: onClose2 } = open(editState);
    await userEvent.type(screen.getByPlaceholderText("Serial number"), "x");
    await userEvent.keyboard("{Escape}");
    expect(screen.getByText("Discard your changes?")).toBeTruthy();
    expect(onClose2).not.toHaveBeenCalled();
  });
});
