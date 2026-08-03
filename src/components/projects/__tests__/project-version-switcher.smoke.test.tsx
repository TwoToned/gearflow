// @vitest-environment jsdom
//
// Phase 3 (#1080/#1093) jsdom smoke coverage, extended for Phase 5
// ("fine-tune versioning" — the header switcher becomes the version menu):
// the header switcher must actually OPEN (it's a Radix dropdown — a
// closed-trigger render proves nothing, see CLAUDE.md's Select/Tooltip
// footguns) and the read-only bar must render its announced text. Both
// consume `useProjectVersion()` from context, mocked here so neither needs a
// ConvexProvider in the tree. The row actions' own dialogs
// (PromoteVersionDialog/SendQuoteDialog/DeleteVersionDialog) are stubbed —
// each has its own dedicated test file; this file only proves the switcher
// offers the right actions for the right row state and wires "Add version".
import React from "react";
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const mockUseProjectVersion = vi.fn();
vi.mock("@/components/projects/project-version-context", () => ({
  useProjectVersion: () => mockUseProjectVersion(),
}));

const mockUseCanDo = vi.fn(() => true);
vi.mock("@/lib/use-permissions", () => ({
  useCanDo: () => mockUseCanDo(),
}));

const mockSaveVersion = vi.fn(async () => ({ id: "q3", version: 3, savedRevision: 2 }));
vi.mock("@/hooks/use-project-version-writes", () => ({
  useProjectVersionWrites: () => ({ saveVersion: mockSaveVersion, promoteRevision: vi.fn() }),
}));

vi.mock("@/components/projects/finance/promote-version-dialog", () => ({
  PromoteVersionDialog: () => null,
}));
vi.mock("@/components/projects/finance/promote-conflicts-panel", () => ({
  PromoteConflictsPanel: () => null,
}));
vi.mock("@/components/projects/finance/delete-version-dialog", () => ({
  DeleteVersionDialog: () => null,
}));
vi.mock("@/components/projects/finance/send-quote-dialog", () => ({
  SendQuoteDialog: () => null,
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

// `mockReturnValueOnce` gets consumed by the render triggered when `openMenu()`
// changes the DropdownMenu's open state, not just the initial render — reset
// explicitly after each test instead of relying on a one-shot override.
afterEach(() => {
  mockUseCanDo.mockReturnValue(true);
});

const SWITCHER_PROPS = {
  orgId: "org1",
  projectNumber: "P-100",
  clientId: "client1",
  projectStatus: "PLANNING",
  subtotal: 500,
  taxAmount: 50,
  total: 550,
};

function openMenu() {
  const trigger = screen.getByRole("button", { name: /project versions/i });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  return trigger;
}

const VERSIONS = [
  { revision: 2, quoteId: "q2", status: "DRAFT" as const, isLive: true, hasSnapshot: false, total: 500, createdAt: 2 },
  { revision: 1, quoteId: "q1", status: "SENT" as const, isLive: false, hasSnapshot: true, total: 400, sentAt: 1, pdfFileId: "file1" },
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
    const { container } = render(<ProjectVersionSwitcher {...SWITCHER_PROPS} />);
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
    const { container } = render(<ProjectVersionSwitcher {...SWITCHER_PROPS} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the trigger without throwing", () => {
    mockUseProjectVersion.mockReturnValue({
      projectId: "proj1",
      versions: VERSIONS,
      isLoadingVersions: false,
      liveRevision: 2,
      viewingRevision: null,
      isViewingVersion: false,
      setViewingRevision: vi.fn(),
    });
    expect(() => render(<ProjectVersionSwitcher {...SWITCHER_PROPS} />)).not.toThrow();
  });

  // Regression: a never-quoted project's `listVersions` synthesizes a virtual
  // live entry (`quoteId: ""`) rather than returning an empty list — the
  // header button must still render and offer "Add version"/"Send".
  it("renders for a never-quoted project via the synthesized live entry", async () => {
    mockUseProjectVersion.mockReturnValue({
      projectId: "proj1",
      versions: [{ revision: 1, quoteId: "", status: "DRAFT" as const, isLive: true, hasSnapshot: false, total: null, createdAt: 1 }],
      isLoadingVersions: false,
      liveRevision: 1,
      viewingRevision: null,
      isViewingVersion: false,
      setViewingRevision: vi.fn(),
    });
    render(<ProjectVersionSwitcher {...SWITCHER_PROPS} />);
    expect(screen.getByRole("button", { name: /project versions/i })).toBeTruthy();
    openMenu();
    const menu = within(await screen.findByRole("menu"));
    expect(menu.getByText(/v1 · Live/)).toBeTruthy();
    expect(menu.getByLabelText(/send v1/i)).toBeTruthy();
    expect(menu.queryByLabelText(/delete v1/i)).toBeNull();
    expect(menu.getByText(/add version/i)).toBeTruthy();
  });

  // Regression: the switcher must actually OPEN and list every version with
  // its state/date/total (#1093 acceptance criteria) — not just render a
  // closed trigger that happens not to crash.
  it("opens the menu and lists every version with state and total", async () => {
    mockUseProjectVersion.mockReturnValue({
      projectId: "proj1",
      versions: VERSIONS,
      isLoadingVersions: false,
      liveRevision: 2,
      viewingRevision: null,
      isViewingVersion: false,
      setViewingRevision: vi.fn(),
    });
    render(<ProjectVersionSwitcher {...SWITCHER_PROPS} />);
    openMenu();
    await waitFor(() => expect(screen.getByText("Versions")).toBeTruthy());
    const menu = within(screen.getByRole("menu"));
    expect(menu.getByText(/v2 · Live/)).toBeTruthy();
    expect(menu.getByText(/v1 · Sent/)).toBeTruthy();
    expect(menu.getAllByText(/\$500|\$400/).length).toBeGreaterThan(0);
  });

  // Regression: each row's action icons match its eligibility — the live
  // never-sent DRAFT offers Send + Delete (an undo, same as the rail's own
  // "Delete draft"), never Make live; the non-live SENT-with-a-document row
  // offers Make live + Download, never Send or Delete (it was already sent).
  it("shows row actions matching each version's state", async () => {
    mockUseProjectVersion.mockReturnValue({
      projectId: "proj1",
      versions: VERSIONS,
      isLoadingVersions: false,
      liveRevision: 2,
      viewingRevision: null,
      isViewingVersion: false,
      setViewingRevision: vi.fn(),
    });
    render(<ProjectVersionSwitcher {...SWITCHER_PROPS} />);
    openMenu();
    const menu = within(await screen.findByRole("menu"));
    expect(menu.getByLabelText(/send v2/i)).toBeTruthy();
    expect(menu.getByLabelText(/delete v2/i)).toBeTruthy();
    expect(menu.queryByLabelText(/make v2 live/i)).toBeNull();

    expect(menu.getByLabelText(/make v1 live/i)).toBeTruthy();
    expect(menu.getByLabelText(/download v1 document/i)).toBeTruthy();
    expect(menu.queryByLabelText(/send v1/i)).toBeNull();
    expect(menu.queryByLabelText(/delete v1/i)).toBeNull();
  });

  // Regression: without invoice:publish, only the read-only list renders —
  // no Add version, no mutating row actions.
  it("hides mutating actions without invoice:publish", async () => {
    mockUseCanDo.mockReturnValue(false);
    mockUseProjectVersion.mockReturnValue({
      projectId: "proj1",
      versions: VERSIONS,
      isLoadingVersions: false,
      liveRevision: 2,
      viewingRevision: null,
      isViewingVersion: false,
      setViewingRevision: vi.fn(),
    });
    render(<ProjectVersionSwitcher {...SWITCHER_PROPS} />);
    openMenu();
    const menu = within(await screen.findByRole("menu"));
    expect(menu.queryByText(/add version/i)).toBeNull();
    expect(menu.queryByLabelText(/send v2/i)).toBeNull();
    expect(menu.queryByLabelText(/make v1 live/i)).toBeNull();
    // Download stays available — it isn't a write.
    expect(menu.getByLabelText(/download v1 document/i)).toBeTruthy();
  });

  // Regression: "Add version" calls saveVersionNative (via the hook) rather
  // than requiring the current live revision's quote to be sent first — the
  // fix for "can't make v2 unless v1's quote is sent".
  it("Add version calls saveVersion for the current project", async () => {
    mockUseProjectVersion.mockReturnValue({
      projectId: "proj1",
      versions: VERSIONS,
      isLoadingVersions: false,
      liveRevision: 2,
      viewingRevision: null,
      isViewingVersion: false,
      setViewingRevision: vi.fn(),
    });
    render(<ProjectVersionSwitcher {...SWITCHER_PROPS} />);
    openMenu();
    const addItem = await screen.findByText(/add version/i);
    fireEvent.click(addItem);
    await waitFor(() => expect(mockSaveVersion).toHaveBeenCalledWith("proj1"));
  });

  // Regression: clicking a non-live version calls setViewingRevision with its
  // number; clicking the live one clears `?v=` (passes null).
  it("clicking a version updates the viewed revision", async () => {
    const setViewingRevision = vi.fn();
    mockUseProjectVersion.mockReturnValue({
      projectId: "proj1",
      versions: VERSIONS,
      isLoadingVersions: false,
      liveRevision: 2,
      viewingRevision: null,
      isViewingVersion: false,
      setViewingRevision,
    });
    render(<ProjectVersionSwitcher {...SWITCHER_PROPS} />);
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
