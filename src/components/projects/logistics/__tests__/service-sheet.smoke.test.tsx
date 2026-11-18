// @vitest-environment jsdom
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { LogisticsService } from "@/lib/logistics-model";
import { marginOf, recentVehicles, serviceFormDefaults, serviceKind } from "../service-sheet/service-form";

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const h = vi.hoisted(() => ({
  mobile: false,
  locked: false,
  manager: true,
  update: vi.fn().mockResolvedValue({ id: "s1" }),
}));

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => h.mobile }));
vi.mock("@/hooks/use-project-service-writes", () => ({ useProjectServiceWrites: () => ({ update: h.update }) }));
vi.mock("@/hooks/use-crew", () => ({ useCrewRoles: () => [{ id: "r1", name: "Warehouse", isActive: true, chargeRate: 400, rateType: "DAILY" }] }));
vi.mock("@/hooks/use-project-lock", () => ({ useProjectPricingLock: () => ({ pricingLocked: h.locked, loading: false }) }));
vi.mock("@/lib/lock-copy", () => ({ resolveLockCopy: () => ({ oneLiner: "Pricing locked: quote sent" }), scrollToLockStrip: vi.fn() }));
vi.mock("@/hooks/use-xero-linked", () => ({ useXeroLinked: () => false }));
vi.mock("@/lib/use-permissions", () => ({ useIsManagerPlus: () => h.manager }));
vi.mock("@/lib/use-org-country", () => ({ useOrgCountry: () => "AU" }));
vi.mock("@/hooks/use-server-query", () => ({ useServerQuery: () => ({ data: [] }) }));
vi.mock("convex/react", () => ({ useConvex: () => ({ query: vi.fn() }), useConvexAuth: () => ({ isAuthenticated: true }) }));
vi.mock("@/server/project-services", () => ({ updateServiceCrewStatus: vi.fn(), generateCrewMessage: vi.fn() }));
vi.mock("../use-logistics-writes", () => ({ refreshLogistics: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/address-input", () => ({
  AddressInput: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="Address" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { ServiceSheet, type ServiceSheetProps } from "../service-sheet/service-sheet";

const base = (o: Partial<LogisticsService> = {}): LogisticsService => ({
  id: "s1", type: "DELIVERY", title: "Delivery", date: "2026-11-11T00:00:00.000Z", endDate: null,
  startTime: "08:00", endTime: "09:00", scheduledTime: "07:30", status: "PLANNED", address: "1 Pitt St",
  latitude: null, longitude: null, vehicleDescription: "3t truck", lineTotal: null, costTotal: null,
  crewCountRequired: 2, crewRole: null, crewAssignments: [], ...o,
});

function props(service: LogisticsService | null, extra: Partial<ServiceSheetProps> = {}): ServiceSheetProps {
  return {
    service, onClose: vi.fn(), projectId: "p1", orgId: "org1", venue: "Venue Hall", contact: { name: "Priya", phone: "0412" },
    services: service ? [service] : [], onPickCrew: vi.fn(), onRemoveCrew: vi.fn(), onDelete: vi.fn(), ...extra,
  };
}

beforeEach(() => {
  h.mobile = false;
  h.locked = false;
  h.manager = true;
  vi.clearAllMocks();
});

describe("service sheet (opens)", () => {
  it("renders nothing while closed", () => {
    render(<ServiceSheet {...props(null)} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens with the five sections and the truck time for a delivery", () => {
    render(<ServiceSheet {...props(base())} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    for (const name of ["When", "Where", "Crew", "Money", "Notes"]) expect(screen.getByRole("region", { name })).toBeTruthy();
    expect(screen.getByLabelText("Truck arrives")).toBeTruthy();
    expect(screen.getByText("Deliver to")).toBeTruthy();
  });

  it("a client pick up swaps Where for Who collects: no vehicle or trips, counter + contact fields", async () => {
    const user = userEvent.setup();
    render(<ServiceSheet {...props(base({ type: "CLIENT_PICKUP", title: "Client pick up", address: "14 Industry Rd" }))} />);
    expect(screen.getByRole("region", { name: "Who collects" })).toBeTruthy();
    expect(screen.queryByText("Trips")).toBeNull();
    expect(screen.getByLabelText("Client collects at")).toBeTruthy();
    expect(screen.getByText(/At our warehouse counter: 14 Industry Rd/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Use the site contact" }));
    expect((screen.getByPlaceholderText("Priya") as HTMLInputElement).value).toBe("Priya");
  });

  it("a client drop off says so and hints when there is no counter address", () => {
    render(<ServiceSheet {...props(base({ type: "CLIENT_DROPOFF", address: null }))} />);
    expect(screen.getByRole("region", { name: "Who drops off" })).toBeTruthy();
    expect(screen.getByText(/Set a warehouse location/)).toBeTruthy();
  });

  it("Pick crew hands the service id to the picker and Delete is confirmed", async () => {
    const user = userEvent.setup();
    const p = props(base());
    render(<ServiceSheet {...p} />);
    await user.click(screen.getByRole("button", { name: /Pick crew/ }));
    expect(p.onPickCrew).toHaveBeenCalledWith("s1");
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Delete service")).toBeTruthy();
  });

  it("opens as a bottom sheet on the phone", () => {
    h.mobile = true;
    render(<ServiceSheet {...props(base())} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Money" })).toBeTruthy();
  });
});

describe("pricing lock", () => {
  it("locks Charge, Discount and Cost with the reason, but not the charge rate override", () => {
    h.locked = true;
    render(<ServiceSheet {...props(base())} />);
    expect(screen.getByText("Pricing locked")).toBeTruthy();
    // LockedField wraps the control in a disabled fieldset.
    expect(screen.getByLabelText("Charge to client").closest("fieldset")?.disabled).toBe(true);
    expect(screen.getByLabelText("Discount").closest("fieldset")?.disabled).toBe(true);
    expect(screen.getByLabelText("Cost").closest("fieldset")?.disabled).toBe(true);
  });

  it("unlocked: fields are plain inputs and Save sends the form with the live crew", async () => {
    const user = userEvent.setup();
    const p = props(base());
    render(<ServiceSheet {...p} />);
    expect(screen.getByLabelText("Charge to client").closest("fieldset")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.update).toHaveBeenCalled());
    expect(h.update.mock.calls[0][0]).toBe("s1");
    expect(h.update.mock.calls[0][1].crew).toEqual([]);
  });

  it("a crew pick made while the sheet is open survives Save (crew is the live set at save time)", async () => {
    const user = userEvent.setup();
    const p = props(base());
    const { rerender } = render(<ServiceSheet {...p} />);
    // Pick crew writes immediately; the live query pushes the new assignment into the open sheet.
    const picked = base({
      crewAssignments: [{ id: "a9", status: "PENDING", estimatedCost: null, crewMember: { id: "m9", firstName: "New", lastName: "Hire", image: null } }],
    });
    rerender(<ServiceSheet {...props(picked)} />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.update).toHaveBeenCalled());
    expect(h.update.mock.calls[0][1].crew.map((c: { crewMemberId: string }) => c.crewMemberId)).toEqual(["m9"]);
  });

  it("cost and margin are manager-only", () => {
    h.manager = false;
    render(<ServiceSheet {...props(base())} />);
    expect(screen.queryByLabelText("Cost")).toBeNull();
    expect(screen.queryByText("Margin")).toBeNull();
  });
});

describe("service-form helpers", () => {
  it("seeds blank strings and keeps client fields", () => {
    const d = serviceFormDefaults(base({ type: "CLIENT_PICKUP", clientContactName: "Priya", clientVehicle: null }));
    expect(d.clientContactName).toBe("Priya");
    expect(d.clientVehicle).toBe("");
    expect(d.date).toBe("2026-11-11");
  });
  it("kinds", () => {
    expect(serviceKind("CLIENT_DROPOFF")).toBe("client");
    expect(serviceKind("PICKUP")).toBe("transport");
    expect(serviceKind("BUMP_OUT")).toBe("multiDay");
    expect(serviceKind("MISC")).toBe("site");
  });
  it("recent vehicles are distinct and non-empty; margin is null with no charge", () => {
    expect(recentVehicles([{ vehicleDescription: "A" }, { vehicleDescription: "A" }, { vehicleDescription: null }])).toEqual(["A"]);
    expect(marginOf(0, 50)).toBeNull();
    expect(marginOf(200, 50)).toEqual({ amount: 150, percent: 75 });
  });
});
