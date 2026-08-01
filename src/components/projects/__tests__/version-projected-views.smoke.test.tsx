// @vitest-environment jsdom
//
// Phase 3 (#1080/#1093) — the read-only projection surfaces for Equipment,
// Labour & logistics, Finance, and the Tasks/Notes/Files "not versioned"
// note. All consume `useProjectVersion()` from context, mocked so no
// ConvexProvider is needed.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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

describe("VersionProjectedEquipment smoke", () => {
  it("renders nothing when not projecting (no context data)", () => {
    mockUseProjectVersion.mockReturnValue({ projected: null, isLoadingProjection: false, viewingRevision: 1 });
    const { container } = render(<VersionProjectedEquipment />);
    expect(container.firstChild).toBeNull();
  });

  it("renders categories/groups/line items from the projected view and the sub-hire/slot caveat", () => {
    mockUseProjectVersion.mockReturnValue({
      projected: projectSnapshotEntries(FIXTURE),
      isLoadingProjection: false,
      viewingRevision: 1,
    });
    render(<VersionProjectedEquipment />);
    expect(screen.getByText("Lighting")).toBeTruthy();
    expect(screen.getByText("MA3 kit")).toBeTruthy();
    expect(screen.getByText(/1× MA3/)).toBeTruthy();
    expect(screen.getByText(/Sub-hires and custom item ordering/)).toBeTruthy();
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
