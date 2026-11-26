// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  writes: { create: vi.fn(), update: vi.fn() },
  push: vi.fn(),
}));

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { id: "org1" } }) }));
vi.mock("@/hooks/use-model-writes", () => ({ useModelWrites: () => h.writes }));
vi.mock("@/hooks/use-test-profiles", () => ({ useTestProfiles: () => [] }));
vi.mock("@/hooks/use-categories", () => ({ useCategoriesWithParent: () => [{ id: "c1", name: "Lighting", parent: null }] }));
vi.mock("@/hooks/use-org-tags", () => ({ useOrgTags: () => [] }));
vi.mock("@/hooks/use-xero-linked", () => ({ useXeroLinked: () => false }));
vi.mock("@/hooks/use-activation-milestones", () => ({ useActiveMilestoneKey: () => undefined }));
vi.mock("@/components/assets/quick-create-category", () => ({ QuickCreateCategory: () => null }));

import { ModelSheet } from "@/components/assets/model-sheet";
import { modelToFormValues } from "@/lib/model-edit-values";

// The Radix checkbox measures itself with ResizeObserver, which jsdom lacks.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

describe("ModelSheet", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    h.writes.create.mockResolvedValue({ id: "new1" });
    h.writes.update.mockResolvedValue({ id: "m1" });
  });

  it("create: name is required, then Create model writes once and reports the new id", async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(<ModelSheet mode="create" onClose={onClose} onSaved={onSaved} />);
    expect(screen.getByRole("dialog", { name: "New model" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Create model" }));
    expect(await screen.findByText("Name is required")).toBeTruthy();
    expect(h.writes.create).not.toHaveBeenCalled();

    await userEvent.type(screen.getByPlaceholderText("e.g. Shure SM58"), "SM58");
    await userEvent.click(screen.getByRole("button", { name: "Create model" }));
    await waitFor(() => expect(h.writes.create).toHaveBeenCalledTimes(1));
    expect(h.writes.create.mock.calls[0][0]).toMatchObject({ name: "SM58", assetType: "SERIALIZED" });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: "new1" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("edit: opens with every stored field, so Save never clears the rates the form did not touch", async () => {
    const values = modelToFormValues({ id: "m1", name: "MAC Aura", dailyRate: 85, weeklyRate: 300, monthlyRate: 900, salePrice: 0, saleStockQuantity: 4, assetType: "SERIALIZED", isActive: true });
    render(<ModelSheet mode="edit" values={values} stock={{ assets: 2, bulk: 0 }} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Edit MAC Aura" })).toBeTruthy();
    expect((screen.getByLabelText("Daily rate ($)") as HTMLInputElement).value).toBe("85");
    await userEvent.type(screen.getByPlaceholderText("e.g. Shure SM58"), "X");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.writes.update).toHaveBeenCalledTimes(1));
    expect(h.writes.update.mock.calls[0][0]).toBe("m1");
    expect(h.writes.update.mock.calls[0][1]).toMatchObject({ name: "MAC AuraX", dailyRate: 85, weeklyRate: 300, monthlyRate: 900, salePrice: 0, saleStockQuantity: 4 });
  });
});
