// @vitest-environment jsdom
// UX Phase 8 (§7b) — the Packing tab, rendered for real: every menu, sheet and
// dialog is OPENED (closed triggers prove nothing), and each write's single Undo
// closure is handed to the toast.
import React from "react";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LineItemData, CategoryData } from "@/components/projects/equipment-rows";

const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush }) }));
const routerPush = vi.hoisted(() => vi.fn());

const writes = vi.hoisted(() => ({
  update: vi.fn(async () => ({ ok: true })),
  create: vi.fn(async () => ({ id: "sl2", lineItemId: "x" })),
  remove: vi.fn(async () => ({ ok: true, batchAuditId: "del1" })),
  undoDeleteContainer: vi.fn(async () => ({ id: "vid", restored: 1, skipped: 0 })),
  seal: vi.fn(async () => ({ ok: true, changed: true })),
  unseal: vi.fn(async () => ({ ok: true, changed: true })),
  setPlannedContainer: vi.fn(async (ids: string[]) => ({ updated: ids.length, changes: [], skipped: [] as { lineItemId: string; reason: string }[], batchAuditId: "batch1" })),
  restorePlannedContainers: vi.fn(async () => ({ restored: 1, skipped: 0 })),
}));
vi.mock("@/hooks/use-project-container-writes", () => ({ useProjectContainerWrites: () => writes }));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

const canManage = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => canManage.value }));

const openLabel = vi.hoisted(() => vi.fn());
vi.mock("@/components/documents/label-submenu", () => ({ openLabel }));

type TestContainer = { id: string; label: string; kind?: string; parentContainerId?: string | null; unitCount: number; sealedAt?: number | null };
const containers = vi.hoisted(() => ({ value: [] as TestContainer[] }));
// The REAL NewContainerSheet renders here (it reads the same `useQuery`): its asset search
// carries a `query` arg and answers `[]`, the job's containers query answers `containers`.
vi.mock("convex/react", () => ({
  useQuery: vi.fn((_ref: unknown, args: unknown) => (args && typeof args === "object" && "query" in args ? [] : containers.value)),
}));
vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { id: "org1" } }) }));

// Radix Select / Popover / Dialog need these in jsdom.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

function line(overrides: Partial<LineItemData> & { id: string }): LineItemData {
  return {
    description: null, quantity: 1, unitPrice: null, lineTotal: null, type: "EQUIPMENT",
    status: "CONFIRMED", isKitChild: false, isContainerLineItem: false,
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

/** The Undo the last success toast offered: the ONE closure that reverses the write. */
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
    { id: "vid", label: "VID-04", kind: "CUSTOM", unitCount: 0 },
    { id: "batt", label: "BATT-01", kind: "CUSTOM", parentContainerId: "lx", unitCount: 0 },
    { id: "sl", label: "SEAL-01", kind: "CUSTOM", unitCount: 0, sealedAt: 1 },
  ];
  equipment = {
    categories: [
      {
        id: "c1", name: "Lighting", sortOrder: 0, groups: [],
        lineItems: [
          line({ id: "aura", description: "MAC Aura", plannedContainerId: "lx" }),
          line({ id: "wash", description: "Rogue wash", units: [{ id: "u1", ordinal: 1, containerId: "lx" }] }),
          line({ id: "par", description: "Par Can" }),
          line({ id: "strobe", description: "Strobe", plannedContainerId: "sl" }),
        ],
      },
      {
        id: "c2", name: "Video", sortOrder: 1, groups: [],
        lineItems: [
          line({ id: "panel", description: "LED panel" }),
          line({ id: "moved", description: "Moved box", plannedContainerId: "vid", units: [{ id: "u2", ordinal: 1, containerId: "lx" }] }),
        ],
      },
    ],
    uncategorizedItems: [],
    uncategorizedProjectGroups: [],
    uncategorizedSubHireGroups: [],
    isLoading: false,
  };
});

const setup = () => userEvent.setup();
async function openMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name }));
  return screen.findAllByRole("menuitem");
}
const row = (id: string) => screen.getByTestId(`packing-row-${id}`);

describe("Packing tab body", () => {
  it("shows the Unplanned card (titled Unplanned, not Loose), a card per case, and the footer facts", () => {
    render(<PackingTab projectId="p1" orgId="o1" />);
    const unplanned = screen.getByRole("region", { name: "Unplanned" });
    expect(within(unplanned).getByText("Par Can")).toBeTruthy();
    expect(within(unplanned).getByText("LED panel")).toBeTruthy();
    expect(screen.queryByText("Loose")).toBeNull();
    const lx = screen.getByRole("region", { name: "Case LX-02" });
    expect(within(lx).getByText("3 lines · 2 packed")).toBeTruthy(); // aura (planned only), wash + moved (packed in lx)
    expect(within(screen.getByRole("region", { name: "Case BATT-01" })).getByText("· in LX-02")).toBeTruthy();
    expect(screen.getByText("6 lines · 6 units · 2 packed in the warehouse")).toBeTruthy();
  });

  it("glyph rule: ● Packed on a packed line, and Planned → X ONLY when the plan disagrees with reality", () => {
    render(<PackingTab projectId="p1" orgId="o1" />);
    expect(within(row("wash")).getByText("Packed")).toBeTruthy();
    expect(within(row("wash")).queryByText(/Planned →/)).toBeNull(); // packed, no plan: nothing to disagree with
    expect(within(row("moved")).getByText("Packed")).toBeTruthy();
    expect(within(row("moved")).getByText(/Planned → VID-04/)).toBeTruthy(); // planned vid, packed in lx
    expect(within(row("aura")).queryByText(/Planned →/)).toBeNull(); // planned, not packed: its card says it
  });

  it("search narrows the rows; no match says 'No lines match that'; Clear restores", async () => {
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    await user.type(screen.getByLabelText("Search lines"), "panel");
    expect(screen.getByText("LED panel")).toBeTruthy();
    expect(screen.queryByText("Par Can")).toBeNull();
    await user.clear(screen.getByLabelText("Search lines"));
    await user.type(screen.getByLabelText("Search lines"), "zzz");
    expect(screen.getByText("No lines match that")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("Par Can")).toBeTruthy();
  });

  it("with nothing unplanned the Unplanned card says 'Every line has a case'", () => {
    equipment.categories = [{ id: "c1", name: "Lighting", sortOrder: 0, groups: [], lineItems: [line({ id: "aura", description: "MAC Aura", plannedContainerId: "lx" })] }];
    render(<PackingTab projectId="p1" orgId="o1" />);
    expect(screen.getByText("Every line has a case")).toBeTruthy();
  });

  it("shows 6 lines then 'Show 5 more · n left', and Show every line from the case ⋯ expands", async () => {
    const many = Array.from({ length: 11 }, (_, i) => line({ id: `m${i}`, description: `Item ${i}`, plannedContainerId: "vid" }));
    equipment.categories = [{ id: "c1", name: "Lighting", sortOrder: 0, groups: [], lineItems: many }];
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    const vid = screen.getByRole("region", { name: "Case VID-04" });
    expect(within(vid).getAllByRole("checkbox", { name: /^Select Item/ })).toHaveLength(6);
    await user.click(within(vid).getByRole("button", { name: /Show 5 more · 5 left/ }));
    expect(within(vid).getAllByRole("checkbox", { name: /^Select Item/ })).toHaveLength(11);
  });

  it("'Show 5 more' reveals FIVE rows, not the whole case, and is a 44px target", async () => {
    const many = Array.from({ length: 17 }, (_, i) => line({ id: `m${i}`, description: `Item ${i}`, plannedContainerId: "vid" }));
    equipment.categories = [{ id: "c1", name: "Lighting", sortOrder: 0, groups: [], lineItems: many }];
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    const vid = screen.getByRole("region", { name: "Case VID-04" });
    const more = within(vid).getByRole("button", { name: /Show 5 more · 11 left/ });
    expect(more.className).toContain("min-h-11");
    await user.click(more);
    expect(within(vid).getAllByRole("checkbox", { name: /^Select Item/ })).toHaveLength(11);
    await user.click(within(vid).getByRole("button", { name: /Show 5 more · 6 left/ }));
    expect(within(vid).getAllByRole("checkbox", { name: /^Select Item/ })).toHaveLength(16);
    await user.click(within(vid).getByRole("button", { name: /Show 1 more · 1 left/ }));
    expect(within(vid).getByRole("button", { name: "Show fewer lines" })).toBeTruthy();
  });
});

describe("Case ⋯, seal, delete", () => {
  it("an open case offers Rename, Move into, Unpack, Print, Seal, Delete (last)", async () => {
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    const items = await openMenu(user, "LX-02 actions");
    const names = items.map((i) => i.textContent);
    expect(names).toEqual(expect.arrayContaining([expect.stringMatching(/Rename/), expect.stringMatching(/Print case label/), expect.stringMatching(/Seal/), expect.stringMatching(/Delete case/)]));
    expect(names.at(-1)).toMatch(/Delete case/);
  });

  it("Rename… validates, saves, toasts, and Undo restores the old name", async () => {
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    await openMenu(user, "LX-02 actions");
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
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    await openMenu(user, "LX-02 actions");
    const parent = await screen.findByRole("menuitem", { name: /Move into/ });
    parent.focus();
    await user.keyboard("{ArrowRight}");
    const target = await screen.findByRole("menuitem", { name: "VID-04" });
    expect(screen.queryByRole("menuitem", { name: "BATT-01" })).toBeNull();
    target.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(writes.update).toHaveBeenCalledWith("lx", { parentContainerId: "vid" }));
    lastUndo()();
    expect(writes.update).toHaveBeenLastCalledWith("lx", { parentContainerId: null });
  });

  it("Unpack un-plans only planned lines (packed stay) and its Undo is the server-sourced restore by batch id", async () => {
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    await openMenu(user, "LX-02 actions");
    await user.click(screen.getByRole("menuitem", { name: /Unpack/ }));
    await waitFor(() => expect(writes.setPlannedContainer).toHaveBeenCalledWith(["aura"], null));
    // Unpack IS planInto(ids, null): the same toast, note and Undo as every other plan write.
    expect(toastMock.success).toHaveBeenCalledWith("1 line → Unplanned", expect.objectContaining({ description: "2 packed lines stay (move in the warehouse)" }));
    expect(writes.setPlannedContainer).toHaveBeenCalledTimes(1);
    lastUndo()();
    expect(writes.restorePlannedContainers).toHaveBeenCalledWith("batch1");
  });

  it("Seal calls the seal write, opens the case label, and Undo unseals", async () => {
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    await openMenu(user, "VID-04 actions");
    await user.click(screen.getByRole("menuitem", { name: /^Seal/ }));
    await waitFor(() => expect(writes.seal).toHaveBeenCalledWith("vid"));
    expect(openLabel).toHaveBeenCalledWith("p1", "container-label", "vid");
    lastUndo()();
    expect(writes.unseal).toHaveBeenCalledWith("vid");
  });

  it("a sealed case shows 'Sealed' and its ⋯ has no Rename / Move / Unpack / Delete; Unseal works", async () => {
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    expect(within(screen.getByRole("region", { name: "Case SEAL-01" })).getByText("Sealed")).toBeTruthy();
    const items = await openMenu(user, "SEAL-01 actions");
    const names = items.map((i) => i.textContent);
    expect([...names].sort()).toEqual(["Print case label", "Unseal"]);
    await user.click(screen.getByRole("menuitem", { name: "Unseal" }));
    await waitFor(() => expect(writes.unseal).toHaveBeenCalledWith("sl"));
  });

  it("Delete case… opens a confirm that names the effect; confirming deletes; a CUSTOM case's Undo is ONE call by batch id", async () => {
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    await openMenu(user, "VID-04 actions");
    await user.click(screen.getByRole("menuitem", { name: /Delete case/ }));
    expect(await screen.findByText(/Delete VID-04\?/)).toBeTruthy();
    expect(screen.getByText(/Nothing physical moves|nothing planned in it/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Delete case" }));
    await waitFor(() => expect(writes.remove).toHaveBeenCalledWith("vid"));
    lastUndo()();
    await waitFor(() => expect(writes.undoDeleteContainer).toHaveBeenCalledWith("del1"));
    expect(writes.create).not.toHaveBeenCalled(); // no separate re-create call: it is atomic server-side
    expect(writes.restorePlannedContainers).not.toHaveBeenCalled();
  });

  it("a case holding another case says the delete will be refused until it is moved out", async () => {
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    await openMenu(user, "LX-02 actions"); // BATT-01 is packed inside LX-02
    await user.click(screen.getByRole("menuitem", { name: /Delete case/ }));
    expect(await screen.findByText(/has another case packed inside it/)).toBeTruthy();
  });

  it("Delete surfaces the server's NOT_EMPTY reason as the toast", async () => {
    writes.remove.mockRejectedValueOnce(Object.assign(new Error("[CONVEX] ConvexError"), { data: { code: "NOT_EMPTY", message: "This container still has items packed inside it." } }));
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    await openMenu(user, "LX-02 actions");
    await user.click(screen.getByRole("menuitem", { name: /Delete case/ }));
    await user.click(await screen.findByRole("button", { name: "Delete case" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("This container still has items packed inside it."));
  });

  it("an asset-backed case offers no Undo after delete (it cannot be re-created exactly)", async () => {
    equipment.categories = [{ id: "c1", name: "Lighting", sortOrder: 0, groups: [], lineItems: [line({ id: "par", description: "Par Can" })] }];
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    await openMenu(user, "LX-02 actions");
    await user.click(screen.getByRole("menuitem", { name: /Delete case/ }));
    await user.click(await screen.findByRole("button", { name: "Delete case" }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Deleted LX-02", undefined));
  });

  it("has no ⋯, Add case or drag grips without project:manage_line_items", () => {
    canManage.value = false;
    render(<PackingTab projectId="p1" orgId="o1" />);
    expect(screen.queryByRole("button", { name: "LX-02 actions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add case" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Drag / })).toBeNull();
  });
});

describe("Planning: row ⋯, bulk, one Undo", () => {
  it("row ⋯ Plan into… ▸ plans that line into the case, toasts '1 line → VID-04', and the single Undo restores by batch id", async () => {
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    await openMenu(user, "Par Can actions");
    const parent = await screen.findByRole("menuitem", { name: /Plan into/ });
    parent.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.queryByRole("menuitem", { name: "SEAL-01" })).toBeNull(); // sealed cases are not offered
    const target = await screen.findByRole("menuitem", { name: "VID-04" });
    target.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(writes.setPlannedContainer).toHaveBeenCalledWith(["par"], "vid"));
    expect(toastMock.success).toHaveBeenCalledWith("1 line → VID-04", expect.objectContaining({ action: expect.anything() }));
    lastUndo()();
    expect(writes.restorePlannedContainers).toHaveBeenCalledWith("batch1");
  });

  it("a line planned into a case has Unplan, which plans it to Unplanned", async () => {
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    await openMenu(user, "MAC Aura actions");
    await user.click(screen.getByRole("menuitem", { name: "Unplan" }));
    await waitFor(() => expect(writes.setPlannedContainer).toHaveBeenCalledWith(["aura"], null));
    expect(toastMock.success).toHaveBeenCalledWith("1 line → Unplanned", expect.anything());
  });

  it("a packed line and a line inside a sealed case have no ⋯ and no drag grip", () => {
    render(<PackingTab projectId="p1" orgId="o1" />);
    expect(screen.queryByRole("button", { name: "Rogue wash actions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Drag Rogue wash" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Strobe actions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Drag Strobe" })).toBeNull();
    expect(screen.getByRole("button", { name: "Drag Par Can" })).toBeTruthy();
  });

  it("ticking lines shows the bulk bar; 'Plan 2 into…' plans both in ONE write; packed lines are skipped with a reason", async () => {
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    await user.click(screen.getByRole("checkbox", { name: "Select Par Can" }));
    await user.click(screen.getByRole("checkbox", { name: "Select LED panel" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Rogue wash" })); // packed: ticked but skipped
    const bulk = screen.getByRole("toolbar", { name: "Bulk actions" });
    expect(within(bulk).getByText("3 lines selected")).toBeTruthy();
    await user.click(within(bulk).getByRole("button", { name: /Plan 3 into/ }));
    await user.click(await screen.findByRole("menuitem", { name: "VID-04" }));
    await waitFor(() => expect(writes.setPlannedContainer).toHaveBeenCalledTimes(1));
    expect(writes.setPlannedContainer).toHaveBeenCalledWith(["par", "panel"], "vid");
    expect(toastMock.success).toHaveBeenCalledWith("2 lines → VID-04", expect.objectContaining({ description: "1 packed line stays (move in the warehouse)" }));
  });

  it("the server's sealed-case sentence is the error toast (it names Unseal)", async () => {
    writes.setPlannedContainer.mockRejectedValueOnce(Object.assign(new Error("[CONVEX] ConvexError"), { data: { code: "CASE_SEALED", message: "VID-04 is sealed. Unseal it to plan lines into it." } }));
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    await openMenu(user, "Par Can actions");
    (await screen.findByRole("menuitem", { name: /Plan into/ })).focus();
    await user.keyboard("{ArrowRight}");
    (await screen.findByRole("menuitem", { name: "VID-04" })).focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("VID-04 is sealed. Unseal it to plan lines into it."));
  });

  it("an Undo that restored nothing never says 'Undone': it names why", async () => {
    writes.restorePlannedContainers.mockResolvedValueOnce({ restored: 0, skipped: 1 });
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    await openMenu(user, "MAC Aura actions");
    await user.click(screen.getByRole("menuitem", { name: "Unplan" }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("1 line → Unplanned", expect.anything()));
    const undo = lastUndo();
    toastMock.success.mockClear();
    undo();
    await waitFor(() => expect(toastMock.info).toHaveBeenCalledWith("Nothing was restored", expect.objectContaining({ description: expect.stringMatching(/1 line changed since/) })));
    expect(toastMock.success).not.toHaveBeenCalledWith("Undone", expect.anything());
  });

  it("a partial Undo says how many lines were left as they are", async () => {
    writes.restorePlannedContainers.mockResolvedValueOnce({ restored: 1, skipped: 1 });
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    await openMenu(user, "MAC Aura actions");
    await user.click(screen.getByRole("menuitem", { name: "Unplan" }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("1 line → Unplanned", expect.anything()));
    lastUndo()();
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Undone · 1 line changed since, left as is"));
  });

  it("an Undo the server refuses (a seal, or already undone) shows its sentence as the error", async () => {
    writes.restorePlannedContainers.mockRejectedValueOnce(Object.assign(new Error("[CONVEX] ConvexError"), { data: { code: "CASE_SEALED", message: "LX-02 is sealed. Unseal it to undo this." } }));
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    await openMenu(user, "MAC Aura actions");
    await user.click(screen.getByRole("menuitem", { name: "Unplan" }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("1 line → Unplanned", expect.anything()));
    lastUndo()();
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("LX-02 is sealed. Unseal it to undo this."));
  });

  it("a bulk move leaves lines in a SEALED case out of the write and says so quietly", async () => {
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    expect(screen.queryByRole("checkbox", { name: "Select Strobe" })).toBeNull(); // sealed card: nothing to tick
    expect(screen.queryByRole("checkbox", { name: "Select all in SEAL-01" })).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Select Par Can" }));
    await user.click(within(screen.getByRole("toolbar", { name: "Bulk actions" })).getByRole("button", { name: /Plan 1 into/ }));
    await user.click(await screen.findByRole("menuitem", { name: "VID-04" }));
    await waitFor(() => expect(writes.setPlannedContainer).toHaveBeenCalledWith(["par"], "vid"));
  });

  it("bulk Unplan is present only when a ticked line is planned", async () => {
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    await user.click(screen.getByRole("checkbox", { name: "Select Par Can" })); // not planned
    const bulk = screen.getByRole("toolbar", { name: "Bulk actions" });
    expect(within(bulk).queryByRole("button", { name: /^Unplan/ })).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Select MAC Aura" })); // planned into LX-02
    expect(within(bulk).getByRole("button", { name: "Unplan 2" })).toBeTruthy();
  });
});

describe("Tab ⋯, Add case, phone", () => {
  it("tab ⋯ prints all labels, selects the unplanned, and opens the warehouse page", async () => {
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    await openMenu(user, "Packing actions");
    await user.click(screen.getByRole("menuitem", { name: "Print all case labels" }));
    expect(openLabel).toHaveBeenCalledWith("p1", "container-label");
    await openMenu(user, "Packing actions");
    await user.click(screen.getByRole("menuitem", { name: "Select the unplanned" }));
    expect(screen.getByText("2 lines selected")).toBeTruthy();
    await openMenu(user, "Packing actions");
    await user.click(screen.getByRole("menuitem", { name: "Open the warehouse page" }));
    expect(routerPush).toHaveBeenCalledWith("/warehouse/p1");
  });

  it("+ Add case opens the REAL New container sheet: sealed cases are not parents, and the case is created on the viewed version", async () => {
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" versionId="v2" />);
    await user.click(screen.getByRole("button", { name: "Add case" }));
    expect(await screen.findByText("New container")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Custom" }));
    await user.type(screen.getByLabelText("Label"), "Tub 9");
    await user.click(screen.getByText("Top level"));
    expect(await screen.findByRole("button", { name: "LX-02" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "SEAL-01" })).toBeNull(); // a sealed case refuses having a case packed into it
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(writes.create).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1", versionId: "v2", kind: "CUSTOM", label: "Tub 9" })));
  });

  it("the Category and Status filters OPEN and filter the lines", async () => {
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    await user.click(screen.getByRole("combobox", { name: "Category" }));
    await user.click(await screen.findByRole("option", { name: "Video" }));
    expect(screen.getByText("LED panel")).toBeTruthy();
    expect(screen.queryByText("Par Can")).toBeNull();
    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Packed" }));
    expect(screen.getByText("Moved box")).toBeTruthy();
    expect(screen.queryByText("LED panel")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("Par Can")).toBeTruthy();
  });

  it("phone: the row ⋯ and case ⋯ open as bottom sheets, Add case is pinned, and ticking swaps it for the bulk bar", async () => {
    mobile.value = true;
    const user = setup();
    render(<PackingTab projectId="p1" orgId="o1" />);
    expect(screen.getByRole("button", { name: "Add case" })).toBeTruthy();
    // The tab ⋯ is reachable on a phone too (a bottom sheet): labels, manifest, select the unplanned, warehouse.
    await user.click(screen.getByRole("button", { name: "Packing actions" }));
    for (const name of ["Print all case labels", "Manifest", "Select the unplanned", "Open the warehouse page"]) {
      expect(await screen.findByText(name)).toBeTruthy();
    }
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "LX-02 actions" }));
    expect(await screen.findByText(/Unpack · lines go unplanned/)).toBeTruthy();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Par Can actions" }));
    expect(await screen.findByText(/Plan into/)).toBeTruthy();
    await user.keyboard("{Escape}");
    await user.click(row("par"));
    expect(screen.queryByRole("button", { name: "Add case" })).toBeNull();
    expect(screen.getByRole("toolbar", { name: "Bulk actions" })).toBeTruthy();
  });

  it("renders nothing while loading and the empty state with no plannable equipment", () => {
    equipment.isLoading = true;
    const { container, rerender } = render(<PackingTab projectId="p1" orgId="o1" />);
    expect(container.textContent).toBe("");
    equipment = { ...equipment, isLoading: false, categories: [] };
    rerender(<PackingTab projectId="p1" orgId="o1" />);
    expect(screen.getByText("Nothing to plan yet")).toBeTruthy();
  });
});
