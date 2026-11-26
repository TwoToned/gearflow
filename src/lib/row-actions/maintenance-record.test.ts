import { describe, expect, it, vi } from "vitest";
import { buildMaintenanceActions, buildMaintenancePageMenu, buildMaintenancePartActions, buildMaintenanceRecordActions } from "@/lib/row-actions/maintenance";

const keys = (spec: { items: { key: string }[] }) => spec.items.map((i) => i.key);
const fn = () => vi.fn();

describe("buildMaintenanceRecordActions", () => {
  it("an open job offers Complete… (no Reopen), Delete… is last, red and confirmed", () => {
    const spec = buildMaintenanceRecordActions({ title: "Fix desk", status: "IN_PROGRESS", onComplete: fn(), onReopen: fn(), onDelete: fn() });
    expect(keys(spec)).toEqual(["complete", "delete"]);
    const del = spec.items.at(-1)!;
    expect(del).toMatchObject({ danger: true, group: "danger" });
    expect(del.confirm?.title).toBe("Delete Fix desk?");
  });

  it("a completed job offers Reopen (no Complete); a cancelled one offers neither", () => {
    expect(keys(buildMaintenanceRecordActions({ title: "t", status: "COMPLETED", onComplete: fn(), onReopen: fn() }))).toEqual(["reopen"]);
    expect(keys(buildMaintenanceRecordActions({ title: "t", status: "CANCELLED", onComplete: fn(), onReopen: fn() }))).toEqual([]);
  });

  it("a verb with no handler (the caller cannot) is ABSENT, never disabled", () => {
    expect(keys(buildMaintenanceRecordActions({ title: "t", status: "SCHEDULED" }))).toEqual([]);
    expect(keys(buildMaintenanceRecordActions({ title: "t", status: "SCHEDULED", onDelete: fn() }))).toEqual(["delete"]);
  });
});

describe("the list row and page menus (14a-3b)", () => {
  it("a row offers Mark done… and Check off cycle… right after Edit, each only with a handler (absent, never disabled)", () => {
    const spec = buildMaintenanceActions({ title: "t", onOpen: fn(), onEdit: fn(), onMarkDone: fn(), onCheckOff: fn(), onReschedule: fn(), onDelete: fn() });
    expect(keys(spec)).toEqual(["open", "edit", "mark-done", "check-off", "reschedule", "delete"]);
    expect(keys(buildMaintenanceActions({ title: "t", onOpen: fn(), onEdit: fn(), onReschedule: fn() }))).toEqual(["open", "edit", "reschedule"]);
  });

  it("the page menu holds the two dialogs that replaced /maintenance/due", () => {
    expect(buildMaintenancePageMenu({ onCheckoff: fn(), onSchedules: fn() }).items.map((i) => i.label)).toEqual(["Check off cycle…", "Service schedules…"]);
    expect(buildMaintenancePageMenu({}).items).toEqual([]);
  });
});

describe("buildMaintenancePartActions", () => {
  it("Mark arrived only while on order; Remove is last and red", () => {
    const on = buildMaintenancePartActions({ name: "Strut", arrived: false, onEdit: fn(), onMarkArrived: fn(), onRemove: fn() });
    expect(keys(on)).toEqual(["edit", "arrived", "remove"]);
    expect(on.items.at(-1)).toMatchObject({ danger: true });
    expect(keys(buildMaintenancePartActions({ name: "Strut", arrived: true, onEdit: fn(), onMarkArrived: fn(), onRemove: fn() }))).toEqual(["edit", "remove"]);
  });

  it("no handlers, no items", () => {
    expect(keys(buildMaintenancePartActions({ name: "Strut", arrived: false }))).toEqual([]);
  });
});
