// @vitest-environment jsdom
//
// The Parts tab (14b-3, D76): parts as rows with the derived summary and cost; add / edit / remove / mark arrived each
// announced with an Undo built from that write's own audit id; a blank price stays blank (never 0) and a blank
// optional box CLEARS on edit; no price field and no money for a caller who cannot see job cost; read-only callers see
// no verbs; the old free-text `partsUsed` stays readable.
import React from "react";
import type { FunctionReference } from "convex/server";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/show-error", () => ({ showError: vi.fn() }));

const NOW = Date.UTC(2026, 10, 25, 9);
const DAY = 86_400_000;
const data = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (query: FunctionReference<"query">, args: unknown) => (args === "skip" ? undefined : getFunctionName(query) === "maintenanceParts:listForRecord" ? data.value : undefined),
  };
});
const writes = vi.hoisted(() => ({
  addPart: vi.fn(async (_p: unknown) => ({ id: "p9", auditId: "a1" })),
  editPart: vi.fn(async (_id: string, _set: unknown, _clear: string[]) => ({ changed: true, auditId: "e1" })),
  removePart: vi.fn(async (_id: string) => ({ auditId: "d1" })),
  markArrived: vi.fn(async (_id: string) => ({ changed: true, advanced: false, auditId: "v1" })),
  undoPart: vi.fn(async (_id: string) => {}),
}));
vi.mock("@/components/maintenance/record/use-maintenance-record-writes", () => ({ useMaintenanceRecordWrites: () => writes }));
const toasts = vi.hoisted(() => ({ titles: [] as string[], undo: undefined as undefined | (() => void) }));
vi.mock("@/lib/list-write-toast", () => ({
  announceListWrite: (o: { title: string; performUndo?: () => Promise<unknown> }) => {
    toasts.titles.push(o.title);
    toasts.undo = o.performUndo ? () => void o.performUndo!() : undefined;
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign((t: string) => void toasts.titles.push(t), { success: vi.fn(), error: vi.fn() }) }));

import { PartsTab } from "../record/parts-tab";

const PARTS = [
  { id: "p1", name: "Gas strut", supplierName: "Acme", quantity: 2, etaDate: NOW + 2 * DAY, arrivedAt: null, unitPrice: 12.5 },
  { id: "p2", name: "Cable", supplierName: null, quantity: 1, etaDate: null, arrivedAt: NOW - DAY, unitPrice: null },
];
const payload = (over: Record<string, unknown> = {}) => ({
  parts: PARTS,
  summary: { count: 2, onOrder: 1, arrived: 1, nextEta: NOW + 2 * DAY, late: 0 },
  cost: { parts: 25, labour: 50, total: 75, unpricedParts: 1 },
  truncated: false,
  ...over,
});
const show = (canUpdate = true, note: string | null = null) => render(<PartsTab orgId="org1" recordId="r1" now={NOW} canUpdate={canUpdate} partsUsedNote={note} />);
const rowMenu = async (user: ReturnType<typeof userEvent.setup>, name: string) => user.click(screen.getByRole("button", { name: `${name} actions` }));

beforeEach(() => {
  vi.clearAllMocks();
  toasts.titles = [];
  toasts.undo = undefined;
  data.value = payload();
});

describe("PartsTab", () => {
  it("lists the parts with on order / arrived words, the summary and the derived cost", () => {
    show();
    expect(screen.getByText("Gas strut")).toBeTruthy();
    expect(screen.getByText("On order")).toBeTruthy();
    expect(screen.getByText("Arrived")).toBeTruthy();
    expect(screen.getByText(/2 parts · 1 on order · 1 arrived/)).toBeTruthy();
    expect(screen.getByText(/2 × \$12\.50/)).toBeTruthy();
    expect(screen.getByText("$75.00")).toBeTruthy(); // total
    expect(screen.getByText(/1 part has no price/)).toBeTruthy();
  });

  it("adds a part: a blank price is absent (not 0), the toast Undo is the exact write", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: /Add part/ }));
    await user.type(await screen.findByLabelText("Name"), "Foam");
    await user.click(screen.getByRole("button", { name: "Add part" }));
    await waitFor(() => expect(writes.addPart).toHaveBeenCalled());
    const input = writes.addPart.mock.calls[0][0] as Record<string, unknown>;
    expect(input).toMatchObject({ name: "Foam", quantity: 1 });
    expect(input).not.toHaveProperty("unitPrice");
    expect(toasts.titles).toContain("Added Foam");
    toasts.undo?.();
    await waitFor(() => expect(writes.undoPart).toHaveBeenCalledWith("a1"));
  });

  it("a part needs a name and a whole quantity of at least 1; nothing is written otherwise", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: /Add part/ }));
    await user.click(await screen.findByRole("button", { name: "Add part" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/needs a name/);
    expect(writes.addPart).not.toHaveBeenCalled();
  });

  it("edit CLEARS a box the person emptied (supplier, price, ETA) and Undo is that edit", async () => {
    const user = userEvent.setup();
    show();
    await rowMenu(user, "Gas strut");
    await user.click(await screen.findByText("Edit"));
    await user.clear(await screen.findByLabelText("Supplier"));
    await user.clear(screen.getByLabelText("Unit price ($)"));
    await user.clear(screen.getByLabelText("ETA"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes.editPart).toHaveBeenCalled());
    const [id, set, clear] = writes.editPart.mock.calls[0] as unknown as [string, Record<string, unknown>, string[]];
    expect(id).toBe("p1");
    expect(set).toMatchObject({ name: "Gas strut", quantity: 2 });
    expect([...clear].sort()).toEqual(["etaDate", "supplierName", "unitPrice"]);
    toasts.undo?.();
    await waitFor(() => expect(writes.undoPart).toHaveBeenCalledWith("e1"));
  });

  it("Mark arrived is only on an on-order part, and its toast Undo reverses that arrival", async () => {
    const user = userEvent.setup();
    show();
    await rowMenu(user, "Cable");
    expect(screen.queryByText("Mark arrived")).toBeNull(); // already arrived
    await user.keyboard("{Escape}");
    await rowMenu(user, "Gas strut");
    await user.click(await screen.findByText("Mark arrived"));
    await waitFor(() => expect(writes.markArrived).toHaveBeenCalledWith("p1"));
    expect(toasts.titles).toContain("Gas strut arrived");
    toasts.undo?.();
    await waitFor(() => expect(writes.undoPart).toHaveBeenCalledWith("v1"));
  });

  it("the last arrival that moves the job back to In progress says so", async () => {
    writes.markArrived.mockResolvedValueOnce({ changed: true, advanced: true, auditId: "v2" });
    const user = userEvent.setup();
    show();
    await rowMenu(user, "Gas strut");
    await user.click(await screen.findByText("Mark arrived"));
    await waitFor(() => expect(toasts.titles).toContain("Gas strut arrived: the job is back In progress"));
  });

  it("Remove is red and last, confirms, and its Undo puts the part back", async () => {
    const user = userEvent.setup();
    show();
    await rowMenu(user, "Cable");
    await user.click(await screen.findByText("Remove"));
    await user.click(await screen.findByRole("button", { name: "Remove part" }));
    await waitFor(() => expect(writes.removePart).toHaveBeenCalledWith("p2"));
    toasts.undo?.();
    await waitFor(() => expect(writes.undoPart).toHaveBeenCalledWith("d1"));
  });

  it("a caller who cannot see job cost gets no price box and no money (cost null, price absent)", async () => {
    data.value = payload({ cost: null, parts: PARTS.map(({ unitPrice: _p, ...rest }) => rest) });
    const user = userEvent.setup();
    show();
    expect(screen.queryByText(/\$/)).toBeNull();
    expect(screen.queryByText("Cost")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Add part/ }));
    await screen.findByLabelText("Name");
    expect(screen.queryByLabelText("Unit price ($)")).toBeNull();
  });

  it("a read-only caller sees the parts but no Add part and no row menu", () => {
    show(false);
    expect(screen.getByText("Gas strut")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add part/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Gas strut actions" })).toBeNull();
  });

  it("the old free-text parts note stays readable; no parts reads as an empty state", () => {
    data.value = payload({ parts: [], summary: { count: 0, onOrder: 0, arrived: 0, nextEta: null, late: 0 }, cost: { parts: 0, labour: null, total: null, unpricedParts: 0 } });
    show(true, "Replaced the strut and a hinge");
    expect(screen.getByText("Replaced the strut and a hinge")).toBeTruthy();
    expect(screen.getByText(/No parts yet/)).toBeTruthy();
  });
});
