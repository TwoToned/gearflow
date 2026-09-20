// @vitest-environment jsdom
/**
 * The Accessories section inside the Edit Item window (issue #794 follow-up).
 * Covers the wiring this dialog owns — section visibility, and that the plan
 * write is fired ONLY when the selection moved and ONLY after the line patch
 * resolves. The picker UI itself is covered by
 * `accessory-selection-fields.smoke.test.tsx`, the seed/derive/dirty rules by
 * `src/lib/__tests__/accessory-plan-editor.test.ts`.
 */
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ModelAccessoryDetail } from "@/server/line-items";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  // Radix's Accordion/Select measure via ResizeObserver, which jsdom lacks.
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const ACCESSORIES: ModelAccessoryDetail[] = [
  { id: "row-default", bulkAssetId: "ba-default", quantity: 1, inclusion: "DEFAULT", assetTag: "BA-DEF", modelName: "XLR Cable" },
  { id: "row-optional", bulkAssetId: "ba-optional", quantity: 1, inclusion: "OPTIONAL", assetTag: "BA-OPT", modelName: "Flight Case" },
];

// The editor hook's own queries (Convex + server actions) aren't the subject
// here — drive it directly so the dialog's gating/sequencing is what's tested.
const editorState = {
  accessories: ACCESSORIES,
  selection: { "row-default": true, "row-optional": false } as Record<string, boolean>,
  excludeReasons: {} as Record<string, string>,
  planToSave: { excluded: [], added: [{ bulkAssetId: "ba-optional" }], excludedReasons: [] },
  isDirty: true,
  loaded: true,
};
vi.mock("../use-accessory-plan-editor", () => ({
  useAccessoryPlanEditor: (_item: unknown, enabled: boolean) =>
    enabled
      ? { ...editorState, setSelection: () => {}, setExcludeReasons: () => {} }
      : { accessories: [], selection: {}, excludeReasons: {}, planToSave: { excluded: [], added: [] }, isDirty: false, loaded: false, setSelection: () => {}, setExcludeReasons: () => {} },
}));
vi.mock("@/hooks/use-xero-linked", () => ({ useXeroLinked: () => false }));
vi.mock("@/hooks/use-server-query", () => ({ useServerQuery: () => ({ data: undefined }) }));

import { EditLineItemDialog } from "../edit-line-item-dialog";
import type { LineItemData } from "../equipment-rows";

const ITEM = {
  id: "li1",
  description: "Shure SM58",
  quantity: 1,
  unitPrice: 25,
  modelId: "m1",
} as unknown as LineItemData;

function renderDialog(overrides: Partial<React.ComponentProps<typeof EditLineItemDialog>> = {}) {
  const onSubmit = vi.fn(() => Promise.resolve());
  const onAccessoryPlanChange = vi.fn();
  render(
    <EditLineItemDialog
      item={ITEM}
      projectId="p1"
      isPending={false}
      onClose={() => {}}
      onSubmit={onSubmit}
      onAccessoryPlanChange={onAccessoryPlanChange}
      {...overrides}
    />,
  );
  return { onSubmit, onAccessoryPlanChange };
}

describe("EditLineItemDialog — Accessories section", () => {
  beforeEach(() => {
    editorState.isDirty = true;
  });

  it("renders the picker for an eligible line", () => {
    renderDialog();
    expect(screen.getByText("Accessories")).toBeTruthy();
    expect(screen.getByText("XLR Cable")).toBeTruthy();
    expect(screen.getByText("Flight Case")).toBeTruthy();
  });

  it("opens the 'remove a default needs a reason' dialog from inside the Edit Item dialog", () => {
    // The reason prompt is a Radix Dialog nested inside this Radix Dialog — the
    // overlay composition CLAUDE.md warns about only breaks for a NON-Radix
    // popup, so this pins that the nested one still mounts and is clickable.
    renderDialog();
    const cableCheckbox = screen
      .getAllByRole("checkbox")
      .find((c) => c.closest("label")?.textContent?.includes("XLR Cable"))!;
    fireEvent.click(cableCheckbox);
    expect(screen.getByText("Remove default accessory?")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Remove" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("hides the section for a line that can't own a plan (a kit child)", () => {
    renderDialog({ item: { ...ITEM, isKitChild: true } as LineItemData });
    expect(screen.queryByText("XLR Cable")).toBeNull();
  });

  it("hides the section when the parent wires no plan handler", () => {
    renderDialog({ onAccessoryPlanChange: undefined });
    expect(screen.queryByText("XLR Cable")).toBeNull();
  });

  it("saves the plan only AFTER the line patch resolves", async () => {
    let resolveWrite: () => void = () => {};
    const onSubmit = vi.fn(() => new Promise<void>((r) => { resolveWrite = r; }));
    const { onAccessoryPlanChange } = renderDialog({ onSubmit });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    // The line write is still in flight — the child reconcile must not have run.
    expect(onAccessoryPlanChange).not.toHaveBeenCalled();

    resolveWrite();
    await waitFor(() => expect(onAccessoryPlanChange).toHaveBeenCalledWith("li1", editorState.planToSave));
  });

  it("does not fire the plan write when the selection never moved", async () => {
    editorState.isDirty = false;
    const { onSubmit, onAccessoryPlanChange } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    await Promise.resolve();
    expect(onAccessoryPlanChange).not.toHaveBeenCalled();
  });

  it("skips the plan write when the line patch fails", async () => {
    const onSubmit = vi.fn(() => Promise.reject(new Error("INSUFFICIENT_STOCK")));
    const { onAccessoryPlanChange } = renderDialog({ onSubmit });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(onAccessoryPlanChange).not.toHaveBeenCalled();
  });
});
