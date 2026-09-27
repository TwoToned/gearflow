// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { LineItemData, CategoryData } from "@/components/projects/equipment-rows";

const setPlannedContainerMock = vi.fn(async () => ({ updated: 1 }));

vi.mock("convex/react", () => ({ useQuery: vi.fn(() => []) }));
vi.mock("@/hooks/use-project-container-writes", () => ({
  useProjectContainerWrites: () => ({ setPlannedContainer: setPlannedContainerMock }),
}));
vi.mock("@/components/warehouse/new-container-sheet", () => ({
  NewContainerSheet: () => null,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function line(overrides: Partial<LineItemData> & { id: string }): LineItemData {
  return {
    description: null,
    quantity: 1,
    unitPrice: null,
    lineTotal: null,
    type: "EQUIPMENT",
    status: "CONFIRMED",
    isKitChild: false,
    isContainerLineItem: false,
    ...overrides,
  };
}

let equipmentFixture: {
  categories: CategoryData[];
  uncategorizedItems: LineItemData[];
  uncategorizedProjectGroups: never[];
  uncategorizedSubHireGroups: never[];
  isLoading: boolean;
};

vi.mock("@/hooks/use-native-equipment-tab", () => ({
  useNativeEquipmentTab: () => equipmentFixture,
}));

import { PackingTab } from "./packing-tab";

describe("PackingTab smoke (#1296 build plan phase 4)", () => {
  it("renders an empty state when the project has no plannable equipment", () => {
    equipmentFixture = {
      categories: [],
      uncategorizedItems: [],
      uncategorizedProjectGroups: [],
      uncategorizedSubHireGroups: [],
      isLoading: false,
    };
    render(<PackingTab projectId="p1" orgId="org1" />);
    expect(screen.getByText("Nothing to plan yet")).toBeTruthy();
  });

  it("buckets an unplanned line under Not planned and shows the not-planned count", () => {
    equipmentFixture = {
      categories: [{ id: "c1", name: "Lighting", sortOrder: 0, groups: [], lineItems: [line({ id: "l1", description: "Par Can" })] }],
      uncategorizedItems: [],
      uncategorizedProjectGroups: [],
      uncategorizedSubHireGroups: [],
      isLoading: false,
    };
    render(<PackingTab projectId="p1" orgId="org1" />);
    expect(screen.getByText("1 of 1 lines not planned yet")).toBeTruthy();
    expect(screen.getAllByText("Not planned").length).toBeGreaterThan(0);
    expect(screen.getByText("Par Can")).toBeTruthy();
  });

  it("shows a Packed badge (read-only) for a line with an actually-packed unit, ignoring any stale plan", () => {
    equipmentFixture = {
      categories: [{
        id: "c1", name: "Lighting", sortOrder: 0, groups: [],
        lineItems: [line({
          id: "l1", description: "Par Can", plannedContainerId: "c-old",
          units: [{ id: "u1", ordinal: 1, containerId: "c-new" }],
        })],
      }],
      uncategorizedItems: [],
      uncategorizedProjectGroups: [],
      uncategorizedSubHireGroups: [],
      isLoading: false,
    };
    render(<PackingTab projectId="p1" orgId="org1" />);
    expect(screen.getByText("Packed")).toBeTruthy();
    const select = screen.getByLabelText("Container for Par Can") as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });

  it("changing the picker for an unplanned line calls setPlannedContainer", () => {
    equipmentFixture = {
      categories: [{ id: "c1", name: "Lighting", sortOrder: 0, groups: [], lineItems: [line({ id: "l1", description: "Par Can" })] }],
      uncategorizedItems: [],
      uncategorizedProjectGroups: [],
      uncategorizedSubHireGroups: [],
      isLoading: false,
    };
    render(<PackingTab projectId="p1" orgId="org1" />);
    const select = screen.getByLabelText("Container for Par Can");
    fireEvent.change(select, { target: { value: "" } });
    expect(setPlannedContainerMock).toHaveBeenCalledWith(["l1"], null);
  });

  it("passing containerId is null-safe (renders no crash) when loading", () => {
    equipmentFixture = {
      categories: [], uncategorizedItems: [], uncategorizedProjectGroups: [], uncategorizedSubHireGroups: [],
      isLoading: true,
    };
    const { container } = render(<PackingTab projectId="p1" orgId="org1" />);
    expect(container.textContent).toBe("");
  });
});
