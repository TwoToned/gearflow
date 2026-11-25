import { describe, expect, it, vi } from "vitest";

import {
  clientActions,
  clientBulkActions,
  crewBulkActions,
  crewMemberActions,
  supplierActions,
  supplierBulkActions,
} from "./people";

const keys = (spec: { items: { key: string }[] }) => spec.items.map((i) => i.key);
const fn = vi.fn();

describe("crew row menu", () => {
  const base = { name: "Sam", listStatus: "AVAILABLE", hasEmail: true };
  const full = { onOpen: fn, onOpenInPlanner: fn, onMessage: fn, onAssign: fn, onResendOffer: fn, onLogTime: fn, onDeactivate: fn, onReactivate: fn };
  it("an active member: no Resend offer, no Reactivate; Deactivate last, red, confirmed", () => {
    const spec = crewMemberActions(base, full);
    expect(keys(spec)).toEqual(["open", "planner", "message", "assign", "log-time", "deactivate"]);
    const last = spec.items[spec.items.length - 1];
    expect(last).toMatchObject({ danger: true, group: "danger" });
    expect(last.confirm?.body).toMatch(/calls they already hold stay/i);
  });
  it("Resend offer only for an Unconfirmed member with an email", () => {
    expect(keys(crewMemberActions({ ...base, listStatus: "UNCONFIRMED" }, full))).toContain("resend");
    expect(keys(crewMemberActions({ ...base, listStatus: "UNCONFIRMED", hasEmail: false }, full))).not.toContain("resend");
  });
  it("an inactive member reactivates and can't be assigned, messaged or timed", () => {
    expect(keys(crewMemberActions({ ...base, listStatus: "INACTIVE" }, full))).toEqual(["open", "planner", "reactivate"]);
  });
  it("a handler that is not given is ABSENT (a read-only role)", () => {
    expect(keys(crewMemberActions(base, { onOpen: fn }))).toEqual(["open"]);
  });
  it("bulk verbs carry the count; Deactivate is red, last and confirmed", () => {
    const bulk = crewBulkActions({ onMessage: fn, onAssign: fn, onAddTag: fn, onDeactivate: fn });
    expect(bulk.map((b) => b.label(3))).toEqual(["Message 3", "Assign 3 to job…", "Add tag…", "Deactivate 3"]);
    expect(bulk[3]).toMatchObject({ danger: true });
    expect(bulk[3].confirm).toBeTruthy();
    expect(crewBulkActions({})).toEqual([]);
  });
});

describe("client row menu", () => {
  const row = { name: "Hilton", isActive: true, firstOpenJob: { projectNumber: "#2341" }, xeroLinked: true };
  const full = { onOpen: fn, onOpenJob: fn, onNewJob: fn, onOpenInvoices: fn, onOpenInXero: fn, onAddTag: fn, onArchive: fn, onReactivate: fn };
  it("active: Archive last; Reactivate absent", () => {
    const spec = clientActions(row, full);
    expect(keys(spec)).toEqual(["open", "open-job", "new-job", "invoices", "xero", "tag", "archive"]);
    expect(spec.items.at(-1)).toMatchObject({ danger: true });
    expect(spec.items.find((i) => i.key === "open-job")?.label).toBe("Open job #2341");
  });
  it("archived: Reactivate, no Archive, no New job", () => {
    expect(keys(clientActions({ ...row, isActive: false }, full))).toEqual(["open", "open-job", "invoices", "xero", "tag", "reactivate"]);
  });
  it("no open job / no Xero link: those verbs are absent", () => {
    expect(keys(clientActions({ ...row, firstOpenJob: null, xeroLinked: false }, full))).not.toEqual(expect.arrayContaining(["open-job", "xero"]));
  });
  it("bulk", () => {
    expect(clientBulkActions({ onAddTag: fn, onExport: fn, onArchive: fn }).map((b) => b.label(2))).toEqual(["Add tag…", "Export", "Archive 2"]);
  });
});

describe("supplier row menu", () => {
  const row = { name: "Scene", isActive: true, email: "a@b.co" };
  const full = { onOpen: fn, onOrders: fn, onNewOrder: fn, onEmail: fn, onAddTag: fn, onArchive: fn, onReactivate: fn };
  it("active", () => {
    expect(keys(supplierActions(row, full))).toEqual(["open", "orders", "new-order", "email", "tag", "archive"]);
  });
  it("no email: no Email verb; archived: no New order", () => {
    expect(keys(supplierActions({ ...row, email: null }, full))).not.toContain("email");
    expect(keys(supplierActions({ ...row, isActive: false }, full))).toEqual(["open", "orders", "email", "tag", "reactivate"]);
  });
  it("bulk", () => {
    expect(supplierBulkActions({ onExport: fn, onAddTag: fn, onArchive: fn }).map((b) => b.label(4))).toEqual(["Export", "Add tag…", "Archive 4"]);
  });
});
