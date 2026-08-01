// @vitest-environment jsdom
/**
 * Regression coverage for the whole-row drag fix (no dedicated handle — the
 * row's/card's own root now carries dnd-kit's `useSortable()` ref/attributes/
 * listeners; see equipment-rows.tsx's `DragHandleControls` doc comment).
 *
 * This does NOT (and cannot, in jsdom) verify that holding the row actually
 * starts a drag — dnd-kit's `PointerSensor` activation pipeline isn't
 * reliably triggerable via synthetic `PointerEvent`s outside a real browser
 * (confirmed by hand: even a minimal bare-bones `useSortable` div wired up
 * exactly like dnd-kit's own docs never reaches its delay-based `setTimeout`
 * under `fireEvent.pointerDown` + fake timers here) — that gesture is
 * `/qa`/manual-browser territory, same as every other pointer/touch timing
 * question in this feature (see FEATUREDOCS/47's "Manual/browser QA
 * required" note).
 *
 * What IS verifiable, and is the actual regression this guards: mounting a
 * REAL `DndContext`/`useSortable` around `LineItemRow` and spreading its ref/
 * attributes/listeners onto the row root (not a separate handle) must not
 * break the row's own nested interactive controls — the checkbox, the
 * caller's row-level `onClick` (desktop multi-select), and the kebab menu
 * still need to fire/open normally.
 */
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable } from "@dnd-kit/sortable";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-authed-query", () => ({ useAuthedQuery: () => undefined }));
vi.mock("@/hooks/use-collaboration-writes", () => ({
  useCollaborationWrites: () => ({ setReviewMarker: vi.fn(async () => {}) }),
}));
vi.mock("@/server/warehouse", () => ({ getScanLog: vi.fn(async () => ({ logs: [] })) }));

import { LineItemRow, type LineItemData } from "../equipment-rows";

const baseItem: LineItemData = {
  id: "li1",
  modelId: "m1",
  description: null,
  quantity: 2,
  unitPrice: 100,
  lineTotal: 200,
  model: { name: "Shure QLXD Receiver" },
};

// Same sensor shape as use-equipment-dnd.ts's production setup (a
// delay/tolerance PointerSensor, not a distance-based one) — see that file's
// sensor-setup comment for why (PointerSensor+TouchSensor used to race and
// break touch entirely).
function Harness({
  onSelectChange,
  onClick,
}: {
  onSelectChange: (checked: boolean, shiftKey: boolean) => void;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );
  const { setNodeRef, attributes, listeners } = useSortable({ id: "li-li1" });
  return (
    <DndContext sensors={sensors}>
      <SortableContext items={["li-li1"]}>
        <table>
          <tbody>
            <LineItemRow
              item={baseItem}
              indent=""
              selectable
              isSelected={false}
              onSelectChange={onSelectChange}
              onEdit={vi.fn()}
              onMoveToCategory={vi.fn()}
              onMoveToGroup={vi.fn()}
              onRemove={vi.fn()}
              onClick={onClick}
              dragHandleRef={setNodeRef}
              dragAttributes={attributes as unknown as Record<string, unknown>}
              dragListeners={listeners as unknown as Record<string, unknown>}
            />
          </tbody>
        </table>
      </SortableContext>
    </DndContext>
  );
}

describe("whole-row drag wiring doesn't break nested row controls", () => {
  it("the row root carries dnd-kit's sortable attributes (no separate handle)", () => {
    const { container } = render(<Harness onSelectChange={vi.fn()} />);
    const row = container.querySelector("tr")!;
    expect(row.getAttribute("aria-roledescription")).toBe("sortable");
    expect(row.getAttribute("tabindex")).toBe("0");
    // The dedicated GripVertical handle button is gone — dragging is a
    // property of the row itself now, not a separate small button.
    expect(screen.queryByLabelText("Reorder")).toBeNull();
  });

  it("a click on the checkbox still toggles selection", () => {
    const onSelectChange = vi.fn();
    render(<Harness onSelectChange={onSelectChange} />);
    const checkbox = screen.getByLabelText("Select item");
    fireEvent.click(checkbox);
    expect(onSelectChange).toHaveBeenCalledWith(true, expect.any(Boolean));
  });

  it("a click on the row's own onClick (desktop multi-select) still fires, even though the row root also carries dnd-kit's listeners", () => {
    const onClick = vi.fn();
    const { container } = render(<Harness onSelectChange={vi.fn()} onClick={onClick} />);
    const row = container.querySelector("tr")!;
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalled();
  });

  it("the kebab menu button still opens (not swallowed by the row's drag listeners)", () => {
    // Selected by `aria-haspopup` (the DropdownMenuTrigger) rather than an
    // accessible-name query — same ambiguity risk noted above applies to
    // getByRole name matching once the row itself carries role="button".
    // Radix's DropdownMenu opens on keyboard/pointer events, not a bare
    // click — same as equipment-mobile-cards.smoke.test.tsx's kebab test.
    const { container } = render(<Harness onSelectChange={vi.fn()} />);
    const kebab = container.querySelector('button[aria-haspopup="menu"]')!;
    fireEvent.keyDown(kebab, { key: "Enter" });
    expect(kebab.getAttribute("aria-expanded")).toBe("true");
  });
});
