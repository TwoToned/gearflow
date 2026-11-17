// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { EquipmentList } from "./equipment-list";
import type { EquipmentSections } from "./equipment-sections";
import { equipmentColumns } from "./equipment-sections";
import type { UseEquipmentDndResult } from "@/hooks/use-equipment-dnd";
import type { RowSelection } from "@/lib/primitives/types";

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

const selection: RowSelection = {
  selected: new Set(),
  isSelected: () => false,
  pageState: "none",
  toggle: vi.fn(),
  togglePage: vi.fn(),
  clear: vi.fn(),
  count: 0,
};

const dnd = {
  sensors: [],
  modifiers: [],
  hoveredOverId: "li-b",
  invalidOverId: null,
  draggedRowClone: null,
  handleDragStart: vi.fn(),
  handleDragOver: vi.fn(),
  handleDragEnd: vi.fn(),
  handleDragCancel: vi.fn(),
} as unknown as UseEquipmentDndResult;

const row = (id: string) => ({ id, kind: "gear" as const, title: `Item ${id}`, facts: {} });
const meta = (id: string, disabled = false) => ({
  sortableId: `li-${id}`,
  containerId: "mixed:c1",
  items: ["li-a", "li-b"],
  disabled,
});

const built: EquipmentSections = {
  sections: [
    { section: { id: "cat-c1", title: "Audio" }, rows: [row("a"), row("b"), row("k")] },
    { section: { id: "uncat-zone", title: "Uncategorised" }, rows: [] },
  ],
  rowMeta: new Map([["a", meta("a")], ["b", meta("b")]]),
  sectionMeta: new Map([["cat-c1", { sortableId: "cat-c1", containerId: "categories", items: ["cat-c1"], disabled: false }]]),
};

describe("EquipmentList (dnd-kit through the LineRowList slots)", () => {
  it("makes rows and heads sortable, keeps the uncat-zone landing zone, and skips rows with no meta", () => {
    render(<EquipmentList built={built} columns={equipmentColumns(false)} selection={selection} dnd={dnd} uncatIsEmpty />);
    const a = document.querySelector("tr[data-row-id='a']")!;
    expect(a.hasAttribute("data-drag-row")).toBe(true);
    // the hovered row shows the valid drop ring
    expect(document.querySelector("tr[data-row-id='b']")!.className).toContain("ring-ok");
    // a sortable row has a working grip; a meta-less (derived) row does not
    expect(a.querySelector("button[aria-label='Drag to reorder']")).toBeTruthy();
    const k = document.querySelector("tr[data-row-id='k']")!;
    expect(k.hasAttribute("data-drag-row")).toBe(false);
    expect(k.querySelector("button[aria-label='Drag to reorder']")).toBeNull();
    // category head is sortable (hold anywhere), and the Uncategorised zone shows its hint
    expect(document.querySelector("tr[data-section-id='cat-c1']")!.hasAttribute("data-drag-row")).toBe(true);
    expect(screen.getByText(/Drag items or groups here/)).toBeTruthy();
  });
});
