// @vitest-environment jsdom
//
// The three Maintenance dialogs (14a-3b): Check off cycle (the open service cycles, narrowed to one record on request, each
// check-off the existing write), Service schedules (rows with Edit / Deactivate only for a caller who may, Deactivate asks
// first), and the shared Complete dialog (`Mark done…`: loads the record, completes it, announces an Undo from THAT call's
// audit id and none after a Retire).
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
const perms = vi.hoisted(() => ({ allowed: new Set<string>() }));
vi.mock("@/components/auth/permission-gate", () => ({
  CanDo: ({ resource, action, children, fallback }: { resource: string; action: string; children: React.ReactNode; fallback?: React.ReactNode }) => (perms.allowed.has(`${resource}:${action}`) ? <>{children}</> : <>{fallback ?? null}</>),
}));
vi.mock("@/hooks/use-server-mutation", () => ({
  useServerMutation: (o: { mutationFn: (v: unknown) => Promise<unknown>; onSuccess?: (r: never) => void; onError?: (e: Error) => void }) => ({
    isPending: false,
    mutate: (v: unknown) => void o.mutationFn(v).then((r) => o.onSuccess?.(r as never), (e) => o.onError?.(e)),
  }),
}));
const toasts = vi.hoisted(() => ({ titles: [] as string[], undo: undefined as undefined | (() => void) }));
vi.mock("sonner", () => ({ toast: Object.assign((t: string) => void toasts.titles.push(t), { success: (t: string) => void toasts.titles.push(t), error: vi.fn() }) }));
vi.mock("@/lib/list-write-toast", () => ({
  announceListWrite: (o: { title: string; performUndo?: () => Promise<unknown> }) => {
    toasts.titles.push(o.title);
    toasts.undo = o.performUndo ? () => void o.performUndo!() : undefined;
  },
}));

// ── Check off cycle ───────────────────────────────────────────
const worklist = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("@/hooks/use-maintenance-worklist", () => ({ useMaintenanceWorklist: (orgId: string | undefined) => (orgId ? worklist.value : undefined) }));
const checkoff = vi.hoisted(() => ({
  checkOffUnit: vi.fn(async (_r: string, _a: string) => ({ completed: false })),
  checkOffBulkQuantity: vi.fn(async (_r: string, _b: string, _q: number) => ({ completed: false, quantityRecorded: 2 })),
  checkOffAllRemaining: vi.fn(async (_r: string, _b: string) => ({ completed: true, quantityRecorded: 5 })),
}));
vi.mock("@/hooks/use-maintenance-checkoff", () => ({ useMaintenanceCheckoff: () => checkoff }));

// ── Service schedules ─────────────────────────────────────────
const schedules = vi.hoisted(() => ({ rows: undefined as unknown }));
const scheduleWrites = vi.hoisted(() => ({ deactivate: vi.fn(async (_id: string) => ({})) }));
vi.mock("@/hooks/use-service-schedules", () => ({ useServiceSchedules: (orgId: string | undefined) => (orgId ? schedules.rows : undefined), useServiceScheduleWrites: () => scheduleWrites }));
vi.mock("@/components/maintenance/service-schedule-dialog", () => ({ ServiceScheduleDialog: (p: { open: boolean; schedule?: { name: string } }) => (p.open ? <div data-testid="schedule-form">{p.schedule?.name ?? "new"}</div> : null) }));

// ── Complete ──────────────────────────────────────────────────
const record = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (query: FunctionReference<"query">, args: unknown) => (args === "skip" ? undefined : getFunctionName(query) === "maintenanceRecords:recordDetail" ? record.value : undefined),
  };
});
const recordWrites = vi.hoisted(() => ({
  complete: vi.fn(async (_i: unknown) => ({ undoable: true, auditId: "c1" })),
  undoLifecycle: vi.fn(async (_id: string) => {}),
}));
vi.mock("@/components/maintenance/record/use-maintenance-record-writes", () => ({ useMaintenanceRecordWrites: () => recordWrites }));
const completeProps = vi.hoisted(() => ({ last: undefined as undefined | Record<string, unknown> }));
vi.mock("@/components/maintenance/record/complete-dialog", () => ({
  CompleteDialog: (p: Record<string, unknown> & { onComplete: (i: unknown) => Promise<void> }) => {
    completeProps.last = p;
    return <button onClick={() => void p.onComplete({ result: "PASS", completedDate: 1 })}>do-complete</button>;
  },
}));

import { CheckoffDialog } from "../checkoff-dialog";
import { ServiceSchedulesDialog } from "../service-schedules-dialog";
import { CompleteRecordDialog } from "../record/complete-record-dialog";

const unitSection = { scheduleId: "s1", scheduleName: "Annual service", modelId: "m1", modelName: "Mixing desk", recordId: "r1", dueDate: new Date(Date.now() - 86_400_000).toISOString(), status: "SCHEDULED", poolQuantitySnapshot: 2, progress: 1, isBulk: false, units: [{ assetId: "a1", assetTag: "DSK-1", customName: null, checkedOff: true }, { assetId: "a2", assetTag: "DSK-2", customName: null, checkedOff: false }] };
const bulkSection = { scheduleId: "s2", scheduleName: "Quarterly", modelId: "m2", modelName: "Cable", recordId: "r2", dueDate: new Date(Date.now() + 86_400_000).toISOString(), status: "IN_PROGRESS", poolQuantitySnapshot: 10, progress: 5, isBulk: true, bulkAssetId: "b1", bulkAssetTag: "CBL" };

beforeEach(() => {
  vi.clearAllMocks();
  toasts.titles = [];
  toasts.undo = undefined;
  perms.allowed = new Set(["maintenance:update", "maintenance:create", "maintenance:delete"]);
  worklist.value = { stats: { overdue: 1, dueSoon: 0, inProgress: 1 }, sections: [unitSection, bulkSection] };
  schedules.rows = [{ id: "sc1", name: "Annual service", modelName: "Mixing desk", intervalMonths: 12, anchorDate: "2026-01-01T00:00:00.000Z", isActive: true }, { id: "sc2", name: "Old one", modelName: "Cable", intervalMonths: 3, anchorDate: "2025-01-01T00:00:00.000Z", isActive: false }];
  record.value = { title: "Fix desk", nextDueDate: null, cost: 50, assets: [{ assetId: "a1", asset: { assetTag: "DSK-1", model: { name: "Mixing desk" } } }] };
});

describe("CheckoffDialog", () => {
  it("lists the open cycles with their counts; a unit tile and the bulk buttons are the existing check-off writes", async () => {
    const user = userEvent.setup();
    render(<CheckoffDialog open onOpenChange={() => {}} orgId="org1" />);
    expect(screen.getByText("1 overdue · 0 due soon · 1 in progress")).toBeTruthy();
    expect(screen.getByText("Mixing desk")).toBeTruthy();
    await user.click(screen.getByText("DSK-2"));
    await waitFor(() => expect(checkoff.checkOffUnit).toHaveBeenCalledWith("r1", "a2"));
    await user.type(screen.getByLabelText("Quantity"), "2");
    await user.click(screen.getByRole("button", { name: "Check off" }));
    await waitFor(() => expect(checkoff.checkOffBulkQuantity).toHaveBeenCalledWith("r2", "b1", 2));
    await user.click(screen.getByRole("button", { name: /Check all remaining \(5\)/ }));
    await waitFor(() => expect(checkoff.checkOffAllRemaining).toHaveBeenCalledWith("r2", "b1"));
    expect(toasts.titles).toContain("Cycle completed");
  });

  it("with a recordId it shows only that record's cycle; one with nothing left says so", () => {
    const { unmount } = render(<CheckoffDialog open onOpenChange={() => {}} orgId="org1" recordId="r2" />);
    expect(screen.getByText("Cable")).toBeTruthy();
    expect(screen.queryByText("Mixing desk")).toBeNull();
    unmount();
    render(<CheckoffDialog open onOpenChange={() => {}} orgId="org1" recordId="gone" />);
    expect(screen.getByText("That cycle has nothing left to check off.")).toBeTruthy();
  });

  it("a caller without maintenance:update sees the units but cannot check any off", () => {
    perms.allowed = new Set();
    render(<CheckoffDialog open onOpenChange={() => {}} orgId="org1" />);
    expect(screen.getByText("DSK-2")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /DSK-2/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Check all remaining/ })).toBeNull();
  });

  it("closed, it reads nothing (no org passed to the worklist)", () => {
    render(<CheckoffDialog open={false} onOpenChange={() => {}} orgId="org1" />);
    expect(screen.queryByText("Check off cycle")).toBeNull();
  });
});

describe("ServiceSchedulesDialog", () => {
  it("lists the schedules; Edit and New open the form; Deactivate asks first and then deactivates", async () => {
    const user = userEvent.setup();
    render(<ServiceSchedulesDialog open onOpenChange={() => {}} orgId="org1" />);
    expect(screen.getByText("Annual service")).toBeTruthy();
    expect(screen.getByText("Inactive")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Deactivate Old one" })).toBeNull(); // already inactive
    await user.click(screen.getByRole("button", { name: "Edit Annual service" }));
    expect(screen.getByTestId("schedule-form").textContent).toBe("Annual service");
    await user.click(screen.getByRole("button", { name: "Deactivate Annual service" }));
    expect(await screen.findByText("Deactivate schedule?")).toBeTruthy();
    expect(scheduleWrites.deactivate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(scheduleWrites.deactivate).toHaveBeenCalledWith("sc1"));
  });

  it("a caller who may not update, create or delete sees the table and none of its verbs", () => {
    perms.allowed = new Set();
    render(<ServiceSchedulesDialog open onOpenChange={() => {}} orgId="org1" />);
    expect(screen.getByText("Annual service")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New schedule" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Deactivate / })).toBeNull();
  });

  it("no schedules says so", () => {
    schedules.rows = [];
    render(<ServiceSchedulesDialog open onOpenChange={() => {}} orgId="org1" />);
    expect(screen.getByText("No service schedules yet.")).toBeTruthy();
  });
});

describe("CompleteRecordDialog (Mark done…)", () => {
  it("loads the record, passes labour only when the read carried it, and announces an Undo built from THAT call's audit id", async () => {
    const user = userEvent.setup();
    render(<CompleteRecordDialog orgId="org1" id="r1" open onOpenChange={() => {}} />);
    expect(completeProps.last).toMatchObject({ title: "Fix desk", labourVisible: true, storedLabour: 50, open: true });
    expect((completeProps.last!.assets as { assetTag: string }[]).map((a) => a.assetTag)).toEqual(["DSK-1"]);
    await user.click(screen.getByText("do-complete"));
    await waitFor(() => expect(recordWrites.complete).toHaveBeenCalled());
    expect(toasts.titles).toContain("Completed Fix desk");
    toasts.undo?.();
    await waitFor(() => expect(recordWrites.undoLifecycle).toHaveBeenCalledWith("c1"));
  });

  it("a caller who cannot see job cost gets no labour box; a Retire completion has NO Undo", async () => {
    record.value = { title: "Fix desk", nextDueDate: null, assets: [] };
    recordWrites.complete.mockResolvedValueOnce({ undoable: false, auditId: "c2" });
    const user = userEvent.setup();
    render(<CompleteRecordDialog orgId="org1" id="r1" open onOpenChange={() => {}} />);
    expect(completeProps.last).toMatchObject({ labourVisible: false });
    await user.click(screen.getByText("do-complete"));
    await waitFor(() => expect(toasts.titles).toContain("Completed Fix desk"));
    expect(toasts.undo).toBeUndefined();
  });

  it("renders nothing until a record id is given and the record has arrived", () => {
    completeProps.last = undefined;
    record.value = undefined;
    const { container } = render(<CompleteRecordDialog orgId="org1" id="r1" open onOpenChange={() => {}} />);
    expect(container.textContent).toBe("");
    expect(completeProps.last).toBeUndefined();
  });
});
