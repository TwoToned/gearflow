// @vitest-environment jsdom
//
// Phase 3 (#1080/#1093) jsdom smoke coverage: the header switcher must
// actually OPEN (it's a Radix dropdown — a closed-trigger render proves
// nothing, see CLAUDE.md's Select/Tooltip footguns) and the read-only bar
// must render its announced text. Both consume `useProjectVersion()` from
// context, mocked here so neither needs a ConvexProvider in the tree.
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const mockUseProjectVersion = vi.fn();
vi.mock("@/components/projects/project-version-context", () => ({
  useProjectVersion: () => mockUseProjectVersion(),
}));

import { ProjectVersionSwitcher } from "@/components/projects/version-switcher";
import { VersionReadOnlyBar } from "@/components/projects/version-readonly-bar";

// Radix uses pointer-capture + scrollIntoView, which jsdom doesn't implement,
// and opens on keyboard/pointer events (not a bare click) — same shim as
// saved-views-menu.smoke.test.tsx.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

function openMenu() {
  const trigger = screen.getByRole("button", { name: /switch project version/i });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  return trigger;
}

const VERSIONS = [
  { revision: 2, quoteId: "q2", status: "DRAFT" as const, isLive: true, hasSnapshot: false, total: 500, createdAt: 2 },
  { revision: 1, quoteId: "q1", status: "SENT" as const, isLive: false, hasSnapshot: true, total: 400, sentAt: 1 },
];

describe("ProjectVersionSwitcher smoke", () => {
  it("renders nothing while versions are still loading", () => {
    mockUseProjectVersion.mockReturnValue({
      versions: [],
      isLoadingVersions: true,
      liveRevision: null,
      viewingRevision: null,
      isViewingVersion: false,
      setViewingRevision: vi.fn(),
    });
    const { container } = render(<ProjectVersionSwitcher />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for a template/pre-versioning project with zero versions", () => {
    mockUseProjectVersion.mockReturnValue({
      versions: [],
      isLoadingVersions: false,
      liveRevision: null,
      viewingRevision: null,
      isViewingVersion: false,
      setViewingRevision: vi.fn(),
    });
    const { container } = render(<ProjectVersionSwitcher />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the trigger without throwing", () => {
    mockUseProjectVersion.mockReturnValue({
      versions: VERSIONS,
      isLoadingVersions: false,
      liveRevision: 2,
      viewingRevision: null,
      isViewingVersion: false,
      setViewingRevision: vi.fn(),
    });
    expect(() => render(<ProjectVersionSwitcher />)).not.toThrow();
  });

  // Regression: the switcher must actually OPEN and list every version with
  // its state/date/total (#1093 acceptance criteria) — not just render a
  // closed trigger that happens not to crash.
  it("opens the menu and lists every version with state and total", async () => {
    mockUseProjectVersion.mockReturnValue({
      versions: VERSIONS,
      isLoadingVersions: false,
      liveRevision: 2,
      viewingRevision: null,
      isViewingVersion: false,
      setViewingRevision: vi.fn(),
    });
    render(<ProjectVersionSwitcher />);
    openMenu();
    await waitFor(() => expect(screen.getByText("Versions")).toBeTruthy());
    const menu = within(screen.getByRole("menu"));
    expect(menu.getByText(/v2 · Live/)).toBeTruthy();
    expect(menu.getByText(/v1 · Sent/)).toBeTruthy();
    expect(menu.getAllByText(/\$500|\$400/).length).toBeGreaterThan(0);
  });

  // Regression: clicking a non-live version calls setViewingRevision with its
  // number; clicking the live one clears `?v=` (passes null).
  it("clicking a version updates the viewed revision", async () => {
    const setViewingRevision = vi.fn();
    mockUseProjectVersion.mockReturnValue({
      versions: VERSIONS,
      isLoadingVersions: false,
      liveRevision: 2,
      viewingRevision: null,
      isViewingVersion: false,
      setViewingRevision,
    });
    render(<ProjectVersionSwitcher />);
    openMenu();
    const v1Item = await waitFor(() => within(screen.getByRole("menu")).getByText(/v1 · Sent/));
    fireEvent.click(v1Item);
    expect(setViewingRevision).toHaveBeenCalledWith(1);
  });
});

describe("VersionReadOnlyBar smoke", () => {
  it("renders nothing while viewing the live revision", () => {
    mockUseProjectVersion.mockReturnValue({
      isViewingVersion: false,
      hasCapturedState: true,
      viewingVersion: null,
      viewingRevision: null,
      liveRevision: 2,
      setViewingRevision: vi.fn(),
    });
    const { container } = render(<VersionReadOnlyBar orgId="org1" />);
    expect(container.firstChild).toBeNull();
  });

  it("announces the viewed version, read-only, via role=status", () => {
    mockUseProjectVersion.mockReturnValue({
      isViewingVersion: true,
      hasCapturedState: true,
      viewingVersion: { revision: 1, sentAt: Date.UTC(2026, 6, 19), total: 400 },
      viewingRevision: 1,
      liveRevision: 2,
      setViewingRevision: vi.fn(),
    });
    render(<VersionReadOnlyBar orgId="org1" />);
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/Viewing v1/);
    expect(status.textContent).toMatch(/read-only/);
  });

  it("Back to live clears the viewed revision", () => {
    const setViewingRevision = vi.fn();
    mockUseProjectVersion.mockReturnValue({
      isViewingVersion: true,
      hasCapturedState: true,
      viewingVersion: { revision: 1, sentAt: Date.UTC(2026, 6, 19), total: 400 },
      viewingRevision: 1,
      liveRevision: 2,
      setViewingRevision,
    });
    render(<VersionReadOnlyBar orgId="org1" />);
    fireEvent.click(screen.getByRole("button", { name: /back to live/i }));
    expect(setViewingRevision).toHaveBeenCalledWith(null);
  });

  it("renders the pre-versioning 'no captured state' message instead of an error page", () => {
    mockUseProjectVersion.mockReturnValue({
      isViewingVersion: true,
      hasCapturedState: false,
      viewingVersion: null,
      viewingRevision: 1,
      liveRevision: 2,
      setViewingRevision: vi.fn(),
    });
    render(<VersionReadOnlyBar orgId="org1" />);
    expect(screen.getByText(/no captured state/i)).toBeTruthy();
    expect(screen.getByText(/pre-versioning/i)).toBeTruthy();
  });
});
