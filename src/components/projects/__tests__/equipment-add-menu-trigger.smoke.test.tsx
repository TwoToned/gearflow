// @vitest-environment jsdom
//
// Project Versioning v2, Phase 5 (#1231, parent #1221) — this is the
// isolated regression test for the ONE structural difference between the
// Equipment tab's live and non-live renders (D15: warehouse/add verbs are
// greyed with a tooltip, not hidden). `equipment-tab.tsx` is a single,
// ~2,700-line component with a large dependency graph (dnd-kit, seven
// browser-direct write hooks, several Convex subscriptions) — mounting the
// FULL tab in jsdom isn't practical, and isn't necessary: `EquipmentTab`
// has exactly one place that branches on `addDisabledReason` (this trigger,
// now extracted to `equipment-add-menu-trigger.tsx`) and one place that
// threads `versionId` straight through to `useNativeEquipmentTab` with no
// other conditional — so proving THIS component's two states are correct,
// plus the hook-level test proving `versionId` reaches the query
// (`use-native-equipment-tab.test.ts`), together prove the tab is
// structurally identical apart from this one trigger. Mirrors
// `model-roi-tab.smoke.test.tsx`'s pattern, which specifically catches the
// `TooltipProvider`-missing crash class (CLAUDE.md).
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

import { EquipmentAddMenuTrigger } from "@/components/projects/equipment-add-menu-trigger";

describe("EquipmentAddMenuTrigger smoke", () => {
  it("live version (no disabledReason): renders a normal, enabled trigger and opens the menu", async () => {
    const onAddItem = vi.fn();
    render(<EquipmentAddMenuTrigger onAddItem={onAddItem} onAddGroup={vi.fn()} onAddCategory={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: /add/i });
    expect(trigger.getAttribute("aria-disabled")).not.toBe("true");

    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    const addItem = await waitFor(() => screen.getByText("Add item"));
    expect(screen.getByText("Add group")).toBeTruthy();
    expect(screen.getByText("Add category")).toBeTruthy();

    fireEvent.click(addItem);
    expect(onAddItem).toHaveBeenCalled();
  });

  it("non-live version (disabledReason set): renders a single disabled button with its own tooltip, no throw", async () => {
    // Regression: this crashes at RUNTIME (not typecheck/lint/build) if the
    // tooltip has no TooltipProvider ancestor — CLAUDE.md's exact footgun.
    expect(() =>
      render(
        <EquipmentAddMenuTrigger
          disabledReason="v3 isn't live. Make it live to add new items — existing items on v3 are still editable below."
          onAddItem={vi.fn()}
          onAddGroup={vi.fn()}
          onAddCategory={vi.fn()}
        />,
      ),
    ).not.toThrow();

    const trigger = screen.getByRole("button", { name: /add/i });
    expect(trigger.getAttribute("aria-disabled")).toBe("true");
    // Exactly one button — no nested DropdownMenu trigger underneath it.
    expect(screen.getAllByRole("button", { name: /add/i })).toHaveLength(1);

    // Tooltip content isn't in the DOM until hovered/focused (Radix mounts
    // on trigger) — focusing the trigger opens it.
    fireEvent.focus(trigger);
    await waitFor(() => expect(screen.getByText(/isn't live/i)).toBeTruthy());
  });

  it("clicking the disabled trigger never opens a menu or calls a handler", () => {
    const onAddItem = vi.fn();
    render(
      <EquipmentAddMenuTrigger disabledReason="v3 isn't live." onAddItem={onAddItem} onAddGroup={vi.fn()} onAddCategory={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    expect(screen.queryByText("Add item")).toBeNull();
    expect(onAddItem).not.toHaveBeenCalled();
  });
});
