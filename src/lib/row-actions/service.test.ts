import { describe, expect, test, vi } from "vitest";
import type { LogisticsService } from "@/lib/logistics-model";
import { crewActions, crewBulkActions } from "./crew";
import { logisticsPageMenu, type LogisticsPageCtx } from "./logistics-page";
import { serviceActions, serviceBulkActions } from "./service";

const svc = (o: Partial<LogisticsService> = {}): LogisticsService => ({
  id: "s1", type: "BUMP_IN", title: "Bump in", date: "2026-11-11T00:00:00.000Z", endDate: null, startTime: null, endTime: null,
  scheduledTime: null, status: "PLANNED", address: null, latitude: null, longitude: null, vehicleDescription: null,
  lineTotal: null, costTotal: null, crewCountRequired: 3,
  crewRole: null,
  crewAssignments: [{ id: "a1", status: "PENDING", estimatedCost: null, crewMember: { id: "m", firstName: "A", lastName: "B", image: null } }],
  ...o,
});
const keys = (spec: { items: { key: string }[] }) => spec.items.map((i) => i.key);
const noop = () => {};

describe("serviceActions", () => {
  test("a verb the caller cannot do is absent, not disabled", () => {
    expect(keys(serviceActions(svc(), {}))).toEqual([]);
    expect(keys(serviceActions(svc(), { onEdit: noop }))).toEqual(["edit"]);
  });
  test("pick crew names how many are needed; offers name how many go out", () => {
    const spec = serviceActions(svc(), { onPickCrew: noop, onSendOffers: noop });
    expect(spec.items.map((i) => i.label)).toEqual(["Pick crew · 2 needed", "Send 1 offer"]);
  });
  test("move-to omits the day the service is already on; delete is danger, last, and confirms", () => {
    const spec = serviceActions(svc(), {
      onEdit: noop, onMoveTo: noop, onDelete: noop,
      moveTargets: [{ key: "2026-11-11", label: "Tue 11 Nov" }, { key: "2026-11-12", label: "Wed 12 Nov" }],
    });
    const move = spec.items.find((i) => i.key === "move-to");
    expect(move?.children?.map((c) => c.label)).toEqual(["Wed 12 Nov"]);
    const last = spec.items[spec.items.length - 1];
    expect(last).toMatchObject({ key: "delete", danger: true });
    expect(last.confirm?.body).toContain("1 crew assignment");
  });
  test("set status hides the current status", () => {
    const spec = serviceActions(svc({ status: "CONFIRMED" }), { onSetStatus: vi.fn() });
    expect(spec.items[0].children?.map((c) => c.label)).not.toContain("Confirmed");
  });
});

describe("serviceBulkActions (spec 8, 2026-11-04)", () => {
  const all = { onPickCrew: noop, onSendOffers: noop, onConfirm: noop, onSetStatus: noop, onDelete: noop };
  test("labels carry the counts and danger sorts last", () => {
    const rows = [svc({ id: "a" }), svc({ id: "b", crewCountRequired: 0, crewAssignments: [] })];
    const labels = serviceBulkActions(rows, all).map((a) => a.label(0));
    expect(labels).toEqual(["Pick crew · 1 short", "Send 1 offer", "Confirm 2", "Set status…", "Delete"]);
  });
  test("verbs with nothing to act on are absent", () => {
    const done = svc({ status: "CONFIRMED", crewCountRequired: 0, crewAssignments: [] });
    expect(serviceBulkActions([done], all).map((a) => a.key)).toEqual(["set-status", "delete"]);
  });
});

describe("crew actions", () => {
  test("send offer only while pending; remove confirms", () => {
    const pending = crewActions({ id: "a", name: "Dev K", status: "PENDING" }, { onSendOffer: noop, onRemove: noop });
    expect(keys(pending)).toContain("send-offer");
    expect(pending.items.find((i) => i.key === "remove")?.confirm?.title).toContain("Dev K");
    expect(keys(crewActions({ id: "a", name: "Dev K", status: "OFFERED" }, { onSendOffer: noop }))).not.toContain("send-offer");
  });
  test("bulk: confirm counts only those that can still be confirmed", () => {
    const rows = [
      { id: "1", name: "a", status: "PENDING" }, { id: "2", name: "b", status: "CONFIRMED" }, { id: "3", name: "c", status: "DECLINED" },
    ];
    const labels = crewBulkActions(rows, { onSendOffers: noop, onConfirm: noop, onRemove: noop }).map((a) => a.label(0));
    expect(labels).toEqual(["Send 1 offer", "Confirm 1", "Remove"]);
  });
});

describe("logisticsPageMenu", () => {
  const base: LogisticsPageCtx = {
    hasServices: true, hasWindow: true, offerCount: 2, clashCount: 1, crewCount: 3, showCost: false,
    canEditProject: true, canEditCrew: true, canSeeCost: true,
    onEditDates: noop, onGenerate: noop, onImport: noop, onToggleCost: noop, onCallSheet: noop, onPrint: noop,
    onMessage: noop, onRequestAvailability: noop, onOfferAll: noop,
  };
  test("cost and margin is manager-only and off by default", () => {
    expect(keys(logisticsPageMenu(base))).toContain("cost");
    expect(logisticsPageMenu(base).items.find((i) => i.key === "cost")?.label).toBe("Show cost & margin");
    expect(keys(logisticsPageMenu({ ...base, canSeeCost: false }))).not.toContain("cost");
  });
  test("a read-only viewer keeps the call sheet and the print", () => {
    const k = keys(logisticsPageMenu({ ...base, canEditProject: false, canEditCrew: false, canSeeCost: false }));
    expect(k).toEqual(["call-sheet", "print"]);
  });
  test("offer all confirms and names the advisory clash", () => {
    const item = logisticsPageMenu(base).items.find((i) => i.key === "offer-all");
    expect(item?.label).toBe("Offer all · 2");
    expect(item?.confirm?.body).toContain("1 of them clash");
  });
});
