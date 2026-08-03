// @vitest-environment jsdom
//
// Phase 3 (#1080/#1093) — the read-only projection surfaces for Equipment,
// Labour & logistics, Finance, and the Tasks/Notes/Files "not versioned"
// note. All consume `useProjectVersion()` from context, mocked so no
// ConvexProvider is needed.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockUseProjectVersion = vi.fn();
vi.mock("@/components/projects/project-version-context", () => ({
  useProjectVersion: () => mockUseProjectVersion(),
}));

import { VersionProjectedEquipment } from "@/components/projects/version-projected-equipment";
import { VersionProjectedLabour } from "@/components/projects/version-projected-labour";
import { VersionProjectedFinance } from "@/components/projects/version-projected-finance";
import { VersionNotTrackedNote } from "@/components/projects/version-not-tracked-note";
import { projectSnapshotEntries, type SnapshotEntryLike } from "@/lib/project-version-projection";

const FIXTURE: SnapshotEntryLike[] = [
  { entityType: "project", entityId: "p1", data: { name: "Big Gig", total: 1100, subtotal: 1000, taxAmount: 100 } },
  { entityType: "category", entityId: "c1", data: { name: "Lighting", sortOrder: 0 } },
  { entityType: "group", entityId: "g1", data: { categoryId: "c1", title: "MA3 kit", price: 500, sortOrder: 0 } },
  { entityType: "lineItem", entityId: "l1", data: { categoryId: "c1", groupId: "g1", description: "MA3", quantity: 1, unitPrice: 500, sortOrder: 0 } },
  { entityType: "service", entityId: "s1", data: { type: "LABOUR", title: "Bump in", lineTotal: 200, sortOrder: 0 } },
  { entityType: "crewAssignment", entityId: "ca1", data: { crewMemberId: "cm1", estimatedCost: 150 } },
];

// #1080/#1101 — the equipment bundle fixture: one category carrying a
// project group, a sub-hire group and a standalone custom item, ordered via
// categorySlots (sub-hire group in the MIDDLE — proves real interleaving, not
// "groups first, then everything else"). Runs through the ACTUAL
// reconstructProjectCategories pipeline (not mocked), matching CLAUDE.md's
// "unit tests at the plugin layer alone are NOT enough" rule for a
// data-shape change — this is the integration test for the full
// bundle -> reconstruct -> render pipeline.
const EQUIPMENT_BUNDLE = {
  lineItems: [
    {
      id: "l1", organizationId: "org1", projectId: "p1", categoryId: null, groupId: "g1",
      description: "MA3", quantity: 1, unitPrice: 500, lineTotal: 500, type: "EQUIPMENT",
      isKitChild: false, isOptional: false, sortOrder: 0, status: "CONFIRMED",
    },
    {
      id: "l2", organizationId: "org1", projectId: "p1", categoryId: "c1", groupId: null,
      description: "Gaffer tape", quantity: 2, unitPrice: 10, lineTotal: 20, type: "EQUIPMENT",
      isCustomItem: true, isKitChild: false, isOptional: false, sortOrder: 0, status: "CONFIRMED",
    },
  ],
  units: [],
  categories: [{ id: "c1", organizationId: "org1", projectId: "p1", name: "Lighting", sortOrder: 0 }],
  groups: [{ id: "g1", organizationId: "org1", projectId: "p1", categoryId: "c1", title: "MA3 kit", quantity: 1, price: 500, sortOrder: 0 }],
  categorySlots: [
    { id: "cs1", projectCategoryId: "c1", sortOrder: 0, projectGroupId: "g1" },
    { id: "cs2", projectCategoryId: "c1", sortOrder: 1, subHireGroupId: "shg1" },
    { id: "cs3", projectCategoryId: "c1", sortOrder: 2, lineItemId: "l2" },
  ],
  subHires: [{ id: "sh1", organizationId: "org1", supplierId: "sup1", orderNumber: "SH-001", status: "CONFIRMED" }],
  subHireGroups: [{ id: "shg1", subHireId: "sh1", title: "Truss package", sortOrder: 0, quantity: 1, cost: 300, charge: 400, targetCategoryId: "c1" }],
  subHireItems: [{ id: "shi1", subHireId: "sh1", groupId: "shg1", description: "6m truss", quantity: 2, unitCost: 50, unitCharge: 75, sortOrder: 0 }],
  assets: [],
  bulkAssets: [],
  kits: [],
  models: [],
  suppliers: [{ id: "sup1", organizationId: "org1", name: "ACME Rigging" }],
  orgCategories: [],
};

describe("VersionProjectedEquipment smoke", () => {
  it("renders nothing while loading", () => {
    mockUseProjectVersion.mockReturnValue({ isLoadingProjection: true, isLoadingEquipmentBundle: false, equipmentBundle: null, viewingRevision: 1 });
    const { container } = render(<VersionProjectedEquipment />);
    expect(container.textContent).toMatch(/Loading v1/);
  });

  it("shows the empty state when there's no captured bundle", () => {
    mockUseProjectVersion.mockReturnValue({ isLoadingProjection: false, isLoadingEquipmentBundle: false, equipmentBundle: null, viewingRevision: 1 });
    render(<VersionProjectedEquipment />);
    expect(screen.getByText(/No equipment captured for v1/)).toBeTruthy();
  });

  it("renders the category, group, sub-hire group and custom item — interleaved in categorySlots order, no caveat banner, groups collapsed by default", () => {
    mockUseProjectVersion.mockReturnValue({
      isLoadingProjection: false,
      isLoadingEquipmentBundle: false,
      equipmentBundle: EQUIPMENT_BUNDLE,
      viewingRevision: 1,
    });
    render(<VersionProjectedEquipment />);

    expect(screen.getByText("Lighting")).toBeTruthy();
    expect(screen.getByText("MA3 kit")).toBeTruthy();
    // Sub-hire group renders with its supplier + order number.
    expect(screen.getByText("Truss package")).toBeTruthy();
    expect(screen.getByText(/ACME Rigging/)).toBeTruthy();
    expect(screen.getByText(/SH-001/)).toBeTruthy();
    // The custom standalone item is not gated behind a group — always visible.
    expect(screen.getByText("Gaffer tape")).toBeTruthy();
    expect(screen.getByText("Custom")).toBeTruthy();
    // Matches the live tab's own default: groups/sub-hire groups collapsed on
    // first render, so their child rows aren't in the DOM yet.
    expect(screen.queryByText("MA3")).toBeNull();
    expect(screen.queryByText("6m truss")).toBeNull();
    // The old "not captured" caveat is gone — sub-hires ARE captured now.
    expect(screen.queryByText(/Sub-hires and custom item ordering/)).toBeNull();

    // Interleaving order check: the group title, sub-hire group title, and
    // custom item description appear in categorySlots order (0, 1, 2), not
    // "groups first" — regression coverage for the mixedGroups walk.
    const text = document.body.textContent ?? "";
    const groupIdx = text.indexOf("MA3 kit");
    const subHireIdx = text.indexOf("Truss package");
    const customIdx = text.indexOf("Gaffer tape");
    expect(groupIdx).toBeGreaterThanOrEqual(0);
    expect(groupIdx).toBeLessThan(subHireIdx);
    expect(subHireIdx).toBeLessThan(customIdx);

    // Expanding the group/sub-hire group toggles (chevron buttons) reveals
    // their child rows — the read-only equivalent of the live tab's
    // expandedGroups toggle, minus any edit/delete/drag affordances.
    fireEvent.click(screen.getByRole("button", { name: /MA3 kit/ }));
    expect(screen.getByText("MA3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Truss package/ }));
    expect(screen.getByText("6m truss")).toBeTruthy();
  });
});

describe("VersionProjectedLabour smoke", () => {
  it("renders services and crew from the projected view", () => {
    mockUseProjectVersion.mockReturnValue({
      projected: projectSnapshotEntries(FIXTURE),
      isLoadingProjection: false,
      viewingRevision: 1,
    });
    render(<VersionProjectedLabour />);
    expect(screen.getByText("Bump in")).toBeTruthy();
    expect(screen.getByText(/cm1/)).toBeTruthy();
  });
});

describe("VersionProjectedFinance smoke", () => {
  it("renders the financial summary from the projected view, invoices excluded", () => {
    mockUseProjectVersion.mockReturnValue({
      projected: projectSnapshotEntries(FIXTURE),
      isLoadingProjection: false,
      viewingRevision: 1,
    });
    render(<VersionProjectedFinance />);
    expect(screen.getByText(/Invoices aren't versioned/)).toBeTruthy();
  });

  // WS11 (#950) regression: serviceChargeTotal used to be derived as
  // subtotal - equipmentRevenue only, silently folding saleRevenue into
  // "Services". With equipmentRevenue=700, saleRevenue=200 and subtotal=1000,
  // the correct Services figure is 100 (1000 - 700 - 200), not 300.
  it("doesn't fold saleRevenue into Services, and renders its own Sale items row", () => {
    mockUseProjectVersion.mockReturnValue({
      projected: projectSnapshotEntries([
        { entityType: "project", entityId: "p1", data: { name: "Big Gig", total: 1050, subtotal: 1000, taxAmount: 50, equipmentRevenue: 700, saleRevenue: 200 } },
      ]),
      isLoadingProjection: false,
      viewingRevision: 1,
    });
    render(<VersionProjectedFinance />);
    expect(screen.getByText("Sale items")).toBeTruthy();
    expect(screen.getByText("$200.00")).toBeTruthy();
    expect(screen.getByText("Services")).toBeTruthy();
    // subtotal(1000) - equipmentRevenue(700) - saleRevenue(200) = 100 — not 300,
    // which is what the pre-fix (equipmentRevenue-only) subtraction would show.
    expect(screen.getByText("$100.00")).toBeTruthy();
    expect(screen.queryByText("$300.00")).toBeNull();
  });
});

describe("VersionNotTrackedNote smoke", () => {
  it("renders nothing outside a version-viewing context", () => {
    mockUseProjectVersion.mockReturnValue({ isViewingVersion: false });
    const { container } = render(<VersionNotTrackedNote what="Tasks" />);
    expect(container.firstChild).toBeNull();
  });

  it("explains the tab isn't versioned while viewing a version", () => {
    mockUseProjectVersion.mockReturnValue({ isViewingVersion: true });
    render(<VersionNotTrackedNote what="Tasks" />);
    expect(screen.getByText(/Tasks aren't versioned — showing current/)).toBeTruthy();
  });
});
