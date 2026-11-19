// @vitest-environment jsdom
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { LogisticsService } from "@/lib/logistics-model";
import { mergeStops, subHireStops } from "@/lib/logistics-transport";
import { serviceActions } from "@/lib/row-actions/service";
import { useRowSelection } from "@/lib/primitives/use-row-selection";

// Radix Switch measures itself.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }));

const writes = vi.hoisted(() => ({
  updateSchedule: vi.fn().mockResolvedValue(undefined),
  shiftSchedule: vi.fn().mockResolvedValue({ services: 2, crewCalls: 1, undated: 0 }),
  gate: { onProceed: null as null | ((plan: unknown) => void), pending: null as null | { rows: unknown[] } },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@/hooks/use-native-project-writes", () => ({ useProjectWrites: () => ({ updateSchedule: writes.updateSchedule }) }));
vi.mock("@/hooks/use-project-service-writes", () => ({ useProjectServiceWrites: () => ({ shiftSchedule: writes.shiftSchedule }) }));
vi.mock("@/hooks/use-date-move-gate", () => ({
  useDateMoveGate: (_o: unknown, _p: unknown, _s: unknown, _w: unknown, onProceed: (plan: unknown) => void) => {
    writes.gate.onProceed = onProceed;
    return {
      requestSave: vi.fn(async (_w2: unknown, plan: unknown) => onProceed(plan)),
      checking: false,
      pending: writes.gate.pending,
      confirmPending: vi.fn(),
      cancelPending: vi.fn(),
    };
  },
}));
vi.mock("sonner", () => ({ toast: { success: writes.toastSuccess, error: writes.toastError } }));
vi.mock("@/hooks/use-project-crew", () => ({ refreshProjectCrew: vi.fn(), refreshProjectLabourCost: vi.fn() }));
vi.mock("@/hooks/use-project-detail", () => ({ refreshProjectDetail: vi.fn() }));
vi.mock("@/hooks/use-project-services", () => ({ refreshProjectServices: vi.fn(), refreshProjectServicesSummary: vi.fn() }));

import { LogisticsDatesSheet, type ScheduleSnapshot } from "../dates-sheet";
import { DayMode } from "../day-mode";
import { LaneBar } from "../lane-bar";
import { SendOffersDialog } from "../send-offers-dialog";
import { serviceResults } from "../add-service-bar";
import { Timeline } from "../timeline";
import { logisticsColumns, serviceRow } from "../service-rows";
import { groupByDay } from "@/lib/logistics-model";

const svc = (o: Partial<LogisticsService> & { id: string }): LogisticsService => ({
  type: "BUMP_IN", title: o.id, date: "2026-11-11T00:00:00.000Z", endDate: null, startTime: "08:00", endTime: "16:00",
  scheduledTime: null, status: "PLANNED", address: "1 Pitt St", latitude: -33.8, longitude: 151.2, vehicleDescription: null,
  lineTotal: null, costTotal: null, crewCountRequired: 2, crewRole: null,
  crewAssignments: [{ id: `a-${o.id}`, status: "OFFERED", estimatedCost: null, crewMember: { id: "m1", firstName: "Dev", lastName: "K", image: null } }],
  ...o,
});
const services = [
  svc({ id: "Delivery", type: "DELIVERY" }),
  svc({ id: "Bump in" }),
  svc({ id: "Pickup", type: "PICKUP", date: "2026-11-13T00:00:00.000Z" }),
];

beforeEach(() => {
  mobile.value = false;
  vi.clearAllMocks();
  writes.gate.pending = null;
});

const SH = [{ id: "sh1", supplierId: "sup1", orderNumber: "SH-0007", status: "CONFIRMED", hireStart: Date.UTC(2026, 10, 10), hireEnd: Date.UTC(2026, 10, 14) }];
const stops = subHireStops(SH, () => "Acme Hire");

function TimelineHarness({ onEdit, onOpenOrder = () => {} }: { onEdit?: () => void; onOpenOrder?: (id: string) => void }) {
  const groups = mergeStops(groupByDay(services), stops);
  const selection = useRowSelection(groups.flatMap((g) => g.services.map((s) => s.id)));
  return (
    <>
      <span data-testid="count">{selection.count}</span>
      <Timeline
        groups={groups}
        columns={logisticsColumns(false)}
        selection={selection}
        loadInDay="2026-11-11"
        loadOutDay="2026-11-13"
        onOpenOrder={onOpenOrder}
        rowFor={(id) => {
          const s = services.find((x) => x.id === id)!;
          return serviceRow(s, { showCost: false, onOpen: onEdit, menu: serviceActions(s, { onEdit, onPickCrew: () => {}, onDelete: () => {} }) });
        }}
      />
    </>
  );
}

describe("Timeline (desktop)", () => {
  it("renders day headers with the load in / load out notes and one row per service, no per-row buttons", () => {
    render(<TimelineHarness />);
    expect(screen.getByRole("heading", { name: /11 Nov\s*· load in/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /13 Nov\s*· load out/ })).toBeTruthy();
    expect(screen.getAllByRole("checkbox", { name: /^Select (?!page)/ })).toHaveLength(3);
    // The only buttons in a row are the select box, the expander and the ⋯ menu.
    expect(screen.queryByRole("button", { name: /send offer|confirm|pick crew/i })).toBeNull();
  });

  it("opens the row menu and shows the single-row verbs, delete last", async () => {
    const user = userEvent.setup();
    render(<TimelineHarness onEdit={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Delivery actions" }));
    expect(await screen.findByRole("menuitem", { name: /Edit/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Pick crew · 1 needed/ })).toBeTruthy();
    const items = screen.getAllByRole("menuitem").map((i) => i.textContent);
    expect(items[items.length - 1]).toMatch(/Delete/);
  });

  it("shows sub-hire collect and return stops with no checkbox or money, and opens the order", async () => {
    const user = userEvent.setup();
    const onOpenOrder = vi.fn();
    render(<TimelineHarness onOpenOrder={onOpenOrder} />);
    expect(screen.getByText(/Collect from Acme Hire/)).toBeTruthy();
    expect(screen.getByText(/Return to Acme Hire/)).toBeTruthy();
    // A stop-only day gets a header but no service row, and no new checkboxes.
    expect(screen.getByRole("heading", { name: /10 Nov/ })).toBeTruthy();
    expect(screen.getAllByRole("checkbox", { name: /^Select (?!page)/ })).toHaveLength(3);
    await user.click(screen.getAllByRole("button", { name: "Open order SH-0007" })[0]);
    expect(onOpenOrder).toHaveBeenCalledWith("sh1");
  });

  it("ticking a row selects it", async () => {
    const user = userEvent.setup();
    render(<TimelineHarness />);
    await user.click(screen.getByRole("checkbox", { name: "Select Bump in" }));
    expect(screen.getByTestId("count").textContent).toBe("1");
  });
});

describe("DayMode (phone)", () => {
  function Day({ day = "2026-11-11" }: { day?: string }) {
    const groups = groupByDay(services);
    const selection = useRowSelection(services.map((s) => s.id));
    return (
      <DayMode
        groups={groups}
        day={day}
        onDay={() => {}}
        selection={selection}
        menuFor={(s) => serviceActions(s, { onEdit: () => {}, onSetStatus: () => {} })}
        onOpen={() => {}}
        onOpenOrder={() => {}}
      />
    );
  }

  it("shows the day's cards with the call time in mono, directions and a crew list; row menu is a bottom sheet", async () => {
    mobile.value = true;
    const user = userEvent.setup();
    render(<Day />);
    expect(screen.getAllByText("08:00 – 16:00").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Directions" })[0].getAttribute("href")).toContain("-33.8,151.2");
    expect(screen.getByText(/Crew on the day/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Delivery actions" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Edit")).toBeTruthy();
  });
});

describe("LaneBar", () => {
  it("lanes are words with the active one pressed; the needs word sets the Needs crew lane", async () => {
    const onLane = vi.fn();
    const user = userEvent.setup();
    render(<LaneBar view="timeline" onView={() => {}} lane="all" onLane={onLane} needs="3 short of crew · 1 unanswered" />);
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Transport" }));
    expect(onLane).toHaveBeenCalledWith("transport");
    await user.click(screen.getByRole("button", { name: /3 short of crew/ }));
    expect(onLane).toHaveBeenCalledWith("needs");
  });
});

describe("AddServiceBar results", () => {
  it("Call is a one-level choice, never a silent default", () => {
    expect(serviceResults("", "call", []).map((r) => r.title)).toEqual(["Bump in", "Bump out"]);
    expect(serviceResults("", "delivery", []).map((r) => r.id)).toEqual(["type:DELIVERY"]);
  });
  it("templates are results under their own kind and typing narrows", () => {
    const tpl = [{ id: "t1", type: "LABOUR" as const, title: "Rigging crew", isActive: true }];
    expect(serviceResults("rig", null, tpl).map((r) => r.id)).toEqual(["tpl:t1"]);
    expect(serviceResults("", "labour", tpl).map((r) => r.title)).toEqual(["Labour", "Rigging crew"]);
  });
});

describe("SendOffersDialog", () => {
  it("opens, lists who gets what, flags clashes and skips no-email people", async () => {
    const onConfirm = vi.fn();
    render(
      <SendOffersDialog
        open
        onOpenChange={() => {}}
        pending={false}
        onConfirm={onConfirm}
        rows={[
          { id: "1", name: "Dev K", email: "d@x.com", serviceTitle: "Bump in", clash: "Booked: #2338" },
          { id: "2", name: "Cara D", email: null, serviceTitle: "Bump in" },
        ]}
      />,
    );
    expect(screen.getByText("Send 1 offer?")).toBeTruthy();
    expect(screen.getByText("Booked: #2338")).toBeTruthy();
    expect(screen.getByText(/Cara D have no email/)).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Send 1" }));
    expect(onConfirm).toHaveBeenCalledWith(["1"]);
  });
});

describe("LogisticsDatesSheet (linked re-timing)", () => {
  const snapshot: ScheduleSnapshot = {
    rentalStart: "2026-11-11", rentalEnd: "2026-11-13", loadIn: "", loadInTime: "", loadOut: "", loadOutTime: "",
  };
  const open = () =>
    render(
      <LogisticsDatesSheet open onOpenChange={() => {}} orgId="o1" projectId="p1" projectStatus="CONFIRMED" snapshot={snapshot} services={services} />,
    );

  it("moving the rental start previews what will move and saves the window, then shifts once", async () => {
    const user = userEvent.setup();
    open();
    const start = screen.getByLabelText("Rental starts") as HTMLInputElement;
    await user.clear(start);
    await user.type(start, "2026-11-13");
    // delivery + bump in follow load in (2 services, 2 crew calls)
    expect(screen.getByText(/Moves 2 services and 2 crew calls/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save dates" }));
    await waitFor(() => expect(writes.shiftSchedule).toHaveBeenCalledTimes(1));
    expect(writes.updateSchedule).toHaveBeenCalledWith("p1", expect.objectContaining({ rentalStartDate: "2026-11-13" }));
    expect(writes.updateSchedule.mock.invocationCallOrder[0]).toBeLessThan(writes.shiftSchedule.mock.invocationCallOrder[0]);
    expect(writes.shiftSchedule).toHaveBeenCalledWith("p1", { moves: [{ offsetDays: 2, serviceIds: ["Delivery", "Bump in"] }] });
    expect(writes.toastSuccess).toHaveBeenCalledWith(expect.stringContaining("Dates moved"), expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }));
  });

  it("Undo is the same shift reversed, then the window restored", async () => {
    const user = userEvent.setup();
    open();
    const start = screen.getByLabelText("Rental starts") as HTMLInputElement;
    await user.clear(start);
    await user.type(start, "2026-11-12");
    await user.click(screen.getByRole("button", { name: "Save dates" }));
    await waitFor(() => expect(writes.toastSuccess).toHaveBeenCalled());
    const undo = (writes.toastSuccess.mock.calls[0][1] as { action: { onClick: () => void } }).action.onClick;
    undo();
    await waitFor(() => expect(writes.shiftSchedule).toHaveBeenCalledTimes(2));
    expect(writes.shiftSchedule).toHaveBeenLastCalledWith("p1", { moves: [{ offsetDays: -1, serviceIds: ["Delivery", "Bump in"] }] });
    await waitFor(() => expect(writes.updateSchedule).toHaveBeenCalledTimes(2));
    expect(writes.updateSchedule).toHaveBeenLastCalledWith("p1", expect.objectContaining({ rentalStartDate: "2026-11-11" }));
  });

  it("with the switch off only the window is written", async () => {
    const user = userEvent.setup();
    open();
    const start = screen.getByLabelText("Rental starts") as HTMLInputElement;
    await user.clear(start);
    await user.type(start, "2026-11-12");
    await user.click(screen.getByRole("switch", { name: /Move services and crew calls/ }));
    await user.click(screen.getByRole("button", { name: "Save dates" }));
    await waitFor(() => expect(writes.updateSchedule).toHaveBeenCalled());
    expect(writes.shiftSchedule).not.toHaveBeenCalled();
  });

  it("a failed shift says the dates saved and offers to restore the window", async () => {
    writes.shiftSchedule.mockRejectedValueOnce(new Error("boom"));
    const user = userEvent.setup();
    open();
    const start = screen.getByLabelText("Rental starts") as HTMLInputElement;
    await user.clear(start);
    await user.type(start, "2026-11-12");
    await user.click(screen.getByRole("button", { name: "Save dates" }));
    await waitFor(() => expect(writes.toastError).toHaveBeenCalled());
    expect(writes.toastError.mock.calls[0][0]).toContain("Dates saved, but the services did not move");
    expect(writes.toastError.mock.calls[0][1]).toMatchObject({ action: { label: "Restore dates" } });
  });

  it("when the gate finds a shortage the heads-up dialog opens over the sheet", () => {
    writes.gate.pending = { rows: [{ modelId: "m", modelName: "MAC Aura", qty: 2, projectNumbers: ["#2337"] }] };
    open();
    expect(screen.getByText("Moving these dates creates a shortage")).toBeTruthy();
  });
});
