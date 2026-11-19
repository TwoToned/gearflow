// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LineItemData, CategoryData } from "@/components/projects/equipment-rows";

const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }));

const writes = vi.hoisted(() => ({
  update: vi.fn(async () => ({ ok: true })),
  setPlannedContainer: vi.fn(async () => ({ updated: 1 })),
}));
vi.mock("@/hooks/use-project-container-writes", () => ({ useProjectContainerWrites: () => writes }));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

const canManage = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => canManage.value }));

const containers = vi.hoisted(() => ({
  value: [] as Array<{ id: string; label: string; kind?: string; parentContainerId?: string | null; unitCount: number }>,
}));
vi.mock("convex/react", () => ({ useQuery: vi.fn(() => containers.value) }));
vi.mock("@/components/warehouse/new-container-sheet", () => ({ NewContainerSheet: () => null }));

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

let equipment: {
  categories: CategoryData[];
  uncategorizedItems: LineItemData[];
  uncategorizedProjectGroups: never[];
  uncategorizedSubHireGroups: never[];
  isLoading: boolean;
};
vi.mock("@/hooks/use-native-equipment-tab", () => ({ useNativeEquipmentTab: () => equipment }));

import { PackingTab } from "../packing-tab";

/** The Undo the last success toast offered — the ONE closure that reverses the write. */
function lastUndo(): () => void {
  const opts = toastMock.success.mock.calls.at(-1)?.[1] as { action: { onClick: () => void } };
  return opts.action.onClick;
}

beforeEach(() => {
  vi.clearAllMocks();
  mobile.value = false;
  canManage.value = true;
  containers.value = [
    { id: "lx", label: "LX-02", kind: "ASSET", unitCount: 1 },
    { id: "vid", label: "VID-04", kind: "ASSET", unitCount: 0 },
    { id: "batt", label: "BATT-01", kind: "CUSTOM", parentContainerId: "lx", unitCount: 0 },
  ];
  equipment = {
    categories: [
      {
        id: "c1", name: "Lighting", sortOrder: 0, groups: [],
        lineItems: [
          line({ id: "aura", description: "MAC Aura", plannedContainerId: "lx" }),
          line({ id: "wash", description: "Rogue wash", units: [{ id: "u1", ordinal: 1, containerId: "lx" }] }),
        ],
      },
    ],
    uncategorizedItems: [],
    uncategorizedProjectGroups: [],
    uncategorizedSubHireGroups: [],
    isLoading: false,
  };
});

async function openCaseMenu(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole("button", { name: `${label} actions` }));
  return screen.findAllByRole("menuitem");
}

describe("Packing tab case cards", () => {
  it("shows a card per case, empty ones too, with name, kind, nesting and counts", () => {
    render(<PackingTab projectId="p1" orgId="o1" />);
    const lx = screen.getByRole("region", { name: "Case LX-02" });
    expect(within(lx).getByText("2 lines · 1 packed")).toBeTruthy();
    expect(within(lx).getByText("Case")).toBeTruthy();
    const batt = screen.getByRole("region", { name: "Case BATT-01" });
    expect(within(batt).getByText("· in LX-02")).toBeTruthy();
    expect(within(batt).getByText("Nothing planned in this case")).toBeTruthy();
  });

  it("has no ⋯ without project:manage_line_items", () => {
    canManage.value = false;
    render(<PackingTab projectId="p1" orgId="o1" />);
    expect(screen.queryByRole("button", { name: "LX-02 actions" })).toBeNull();
  });

  it("Rename… validates, saves, toasts, and Undo restores the old name", async () => {
    const user = userEvent.setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    await openCaseMenu(user, "LX-02");
    await user.click(screen.getByRole("menuitem", { name: /Rename/ }));
    const input = await screen.findByLabelText("Name");
    await user.clear(input);
    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(writes.update).not.toHaveBeenCalled();

    await user.type(input, "LX-02 front");
    await user.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(writes.update).toHaveBeenCalledWith("lx", { label: "LX-02 front" }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Renamed LX-02 to LX-02 front", expect.anything()));
    lastUndo()();
    expect(writes.update).toHaveBeenLastCalledWith("lx", { label: "LX-02" });
  });

  it("Move into ▸ lists only cases that are not itself or inside it", async () => {
    const user = userEvent.setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    await openCaseMenu(user, "LX-02");
    const parent = await screen.findByRole("menuitem", { name: /Move into/ });
    parent.focus();
    await user.keyboard("{ArrowRight}");
    const target = await screen.findByRole("menuitem", { name: "VID-04" });
    // BATT-01 sits inside LX-02, so it is not offered.
    expect(screen.queryByRole("menuitem", { name: "BATT-01" })).toBeNull();
    target.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(writes.update).toHaveBeenCalledWith("lx", { parentContainerId: "vid" }));
    lastUndo()();
    expect(writes.update).toHaveBeenLastCalledWith("lx", { parentContainerId: null });
  });

  it("Take out of puts a nested case at the top level, and Undo nests it again", async () => {
    const user = userEvent.setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    await openCaseMenu(user, "BATT-01");
    await user.click(screen.getByRole("menuitem", { name: /Take out of LX-02/ }));
    await waitFor(() => expect(writes.update).toHaveBeenCalledWith("batt", { parentContainerId: null }));
    lastUndo()();
    expect(writes.update).toHaveBeenLastCalledWith("batt", { parentContainerId: "lx" });
  });

  it("Unpack sends only planned lines loose and says the packed ones stay", async () => {
    const user = userEvent.setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    await openCaseMenu(user, "LX-02");
    await user.click(screen.getByRole("menuitem", { name: /Unpack/ }));
    await waitFor(() => expect(writes.setPlannedContainer).toHaveBeenCalledWith(["aura"], null));
    expect(toastMock.success).toHaveBeenCalledWith(
      "1 line loose · 1 packed line stays (move in the warehouse)",
      expect.anything(),
    );
    lastUndo()();
    expect(writes.setPlannedContainer).toHaveBeenLastCalledWith(["aura"], "lx");
  });

  it("phone: the case ⋯ opens as a sheet", async () => {
    mobile.value = true;
    const user = userEvent.setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    await user.click(screen.getByRole("button", { name: "LX-02 actions" }));
    expect(await screen.findByText(/Unpack · lines go loose/)).toBeTruthy();
  });
});
