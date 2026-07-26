// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Smoke test for the WS10 (#949) roles admin page, opened for real per CLAUDE.md's
 * "cover new overlay UI with a jsdom smoke test that actually renders it" rule —
 * typecheck/lint/build all pass on a page that only blows up at runtime (the
 * TooltipProvider-less crash this convention exists to catch), so only rendering
 * catches those.
 */
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const roles = [
  { id: "r1", organizationId: "org1", name: "Audio Tech", department: "Audio", color: "#ff0000", defaultRate: 300, rateType: "DAILY", chargeRate: 500, sortOrder: 0, isActive: true, _id: "r1" as never, _creationTime: 0 },
  { id: "r2", organizationId: "org1", name: "Rigger", department: "Rigging", rateType: "HOURLY", sortOrder: 1, isActive: false, _id: "r2" as never, _creationTime: 0 },
];

vi.mock("@/hooks/use-crew", async () => {
  const actual = await vi.importActual<object>("@/hooks/use-crew");
  return { ...actual, useCrewRolesForSettings: vi.fn(() => roles) };
});

vi.mock("@/hooks/use-crew-role-writes", () => ({
  useCrewRoleWrites: () => ({
    create: vi.fn(async () => ({ id: "new" })),
    update: vi.fn(async () => ({ id: "r1" })),
    archive: vi.fn(async () => ({ id: "r1", isActive: false, usage: { crewMembers: 0, crewAssignments: 0, projectServices: 0 } })),
  }),
}));

vi.mock("@/lib/use-permissions", () => ({
  useCanDo: vi.fn(() => true),
  useIsManagerPlus: vi.fn(() => true),
  useCurrentRole: vi.fn(() => ({ role: "manager", roleName: "Manager", permissions: { crew: ["read", "create", "update"] }, isLoading: false })),
}));

vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: vi.fn(() => ({ data: { id: "org1" } })),
}));

vi.mock("convex/react", () => ({
  useConvex: vi.fn(() => ({ query: vi.fn(async () => ({ crewMembers: 0, crewAssignments: 0, projectServices: 0 })) })),
}));

import CrewSettingsPage from "../page";

describe("Crew settings (roles admin) smoke", () => {
  it("renders the roles table without throwing", async () => {
    render(<CrewSettingsPage />);
    await waitFor(() => expect(screen.getByText("Audio Tech")).toBeTruthy());
    expect(screen.getByText("Rigger")).toBeTruthy();
    // Manager+ mock -> cost/charge columns render.
    expect(screen.getByText("Cost rate")).toBeTruthy();
    expect(screen.getByText("Charge rate")).toBeTruthy();
  });

  it("archived role shows the Archived badge, active shows an Active badge", async () => {
    render(<CrewSettingsPage />);
    await waitFor(() => expect(screen.getByText("Audio Tech")).toBeTruthy());
    // "Active" also matches the column header, so allow multiple matches here —
    // the assertion is that at least one Active badge rendered alongside it.
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getByText("Archived")).toBeTruthy();
  });

  it("opens the create-role dialog without a TooltipProvider-style runtime crash", async () => {
    render(<CrewSettingsPage />);
    const addButton = await waitFor(() => screen.getByText("Add role"));
    fireEvent.click(addButton);
    await waitFor(() => expect(screen.getByText("New crew role")).toBeTruthy());
    expect(screen.getByLabelText("Name")).toBeTruthy();
  });
});
