// @vitest-environment jsdom
//
// Project Versioning v2, Phase 5 (#1231, parent #1221) — the header pill.
// Must actually OPEN (a closed-trigger render proves nothing, CLAUDE.md's
// Select/Tooltip/DropdownMenu footguns) and offer switch/New version/
// Compare(disabled)/Manage versions. Consumes `useProjectVersion()` from
// context, mocked here so this doesn't need a ConvexProvider.
import React from "react";
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const mockUseProjectVersion = vi.fn();
vi.mock("@/components/projects/project-version-context", async () => {
  const actual = await vi.importActual<typeof import("@/components/projects/project-version-context")>(
    "@/components/projects/project-version-context",
  );
  return { ...actual, useProjectVersion: () => mockUseProjectVersion() };
});

const mockUseCanDo = vi.fn(() => true);
vi.mock("@/lib/use-permissions", () => ({ useCanDo: () => mockUseCanDo() }));

const mockCreateVersion = vi.fn(async () => ({ id: "v5", number: 5 }));
vi.mock("@/hooks/use-project-version-writes", () => ({
  useProjectVersionWrites: () => ({
    createVersion: mockCreateVersion,
    makeLive: vi.fn(),
    setLabel: vi.fn(),
    deleteVersion: vi.fn(),
  }),
}));

// The Versions panel is its own dedicated test file — stub it here so this
// file only proves the header pill itself.
vi.mock("@/components/projects/versions-panel", () => ({
  VersionsPanel: ({ open }: { open: boolean }) => (open ? <div data-testid="versions-panel-stub" /> : null),
}));

import { ProjectVersionSwitcher } from "@/components/projects/version-switcher";

afterEach(() => {
  mockUseCanDo.mockReturnValue(true);
  mockCreateVersion.mockClear();
});

const VERSIONS = [
  { id: "v4", number: 4, isLive: true, contentState: "ready" as const, createdAt: 2, createdById: "u1" },
  { id: "v3", number: 3, label: "With LED wall", isLive: false, contentState: "ready" as const, createdAt: 1, createdById: "u1" },
];

function baseCtx(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "proj1",
    orgId: "org1",
    versions: VERSIONS,
    isLoadingVersions: false,
    liveVersion: VERSIONS[0],
    viewingNumber: null,
    isViewingVersion: false,
    viewingVersion: null,
    viewingPlanFields: null,
    isLoadingViewingVersion: false,
    setViewingNumber: vi.fn(),
    ...overrides,
  };
}

function openMenu() {
  const trigger = screen.getByRole("button", { name: /project versions/i });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  return trigger;
}

describe("ProjectVersionSwitcher smoke", () => {
  it("renders nothing while versions are still loading", () => {
    mockUseProjectVersion.mockReturnValue(baseCtx({ versions: [], isLoadingVersions: true, liveVersion: null }));
    const { container } = render(<ProjectVersionSwitcher />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the trigger with the live version's label", () => {
    mockUseProjectVersion.mockReturnValue(baseCtx());
    render(<ProjectVersionSwitcher />);
    expect(screen.getByRole("button", { name: /project versions/i }).textContent).toMatch(/v4 · Live/);
  });

  it("opens the menu and lists every version, marking the active one", async () => {
    mockUseProjectVersion.mockReturnValue(baseCtx());
    render(<ProjectVersionSwitcher />);
    openMenu();
    const menu = within(await screen.findByRole("menu"));
    expect(menu.getByText(/v4 · Live/)).toBeTruthy();
    expect(menu.getByText(/v3 · Draft · With LED wall/)).toBeTruthy();
  });

  it("clicking a non-live version switches to it; clicking the live one clears the param", async () => {
    const setViewingNumber = vi.fn();
    mockUseProjectVersion.mockReturnValue(baseCtx({ setViewingNumber }));
    render(<ProjectVersionSwitcher />);
    openMenu();
    const v3Item = await waitFor(() => within(screen.getByRole("menu")).getByText(/v3 · Draft/));
    fireEvent.click(v3Item);
    expect(setViewingNumber).toHaveBeenCalledWith(3);
  });

  it("offers a New version item that calls createVersion and switches to the result", async () => {
    mockUseProjectVersion.mockReturnValue(baseCtx());
    render(<ProjectVersionSwitcher />);
    openMenu();
    const newVersionItem = await screen.findByText(/new version from v4/i);
    fireEvent.click(newVersionItem);
    await waitFor(() => expect(mockCreateVersion).toHaveBeenCalledWith({ fromVersionId: "v4" }));
  });

  it("Compare is present but disabled (#1232, out of scope)", async () => {
    mockUseProjectVersion.mockReturnValue(baseCtx());
    render(<ProjectVersionSwitcher />);
    openMenu();
    const compareItem = await screen.findByText(/compare/i);
    expect(compareItem.closest('[data-disabled], [aria-disabled="true"]')).toBeTruthy();
  });

  it("Manage versions… opens the Versions panel", async () => {
    mockUseProjectVersion.mockReturnValue(baseCtx());
    render(<ProjectVersionSwitcher />);
    openMenu();
    const manageItem = await screen.findByText(/manage versions/i);
    fireEvent.click(manageItem);
    expect(await screen.findByTestId("versions-panel-stub")).toBeTruthy();
  });

  it("hides New version without invoice:publish, but still lists versions", async () => {
    mockUseCanDo.mockReturnValue(false);
    mockUseProjectVersion.mockReturnValue(baseCtx());
    render(<ProjectVersionSwitcher />);
    openMenu();
    const menu = within(await screen.findByRole("menu"));
    expect(menu.queryByText(/new version/i)).toBeNull();
    expect(menu.getByText(/v4 · Live/)).toBeTruthy();
  });

  it("the V keyboard shortcut opens the Versions panel", async () => {
    mockUseProjectVersion.mockReturnValue(baseCtx());
    render(<ProjectVersionSwitcher />);
    fireEvent.keyDown(window, { key: "v" });
    expect(await screen.findByTestId("versions-panel-stub")).toBeTruthy();
  });

  it("the V shortcut is ignored while typing in an input", () => {
    mockUseProjectVersion.mockReturnValue(baseCtx());
    render(
      <div>
        <input aria-label="some field" />
        <ProjectVersionSwitcher />
      </div>,
    );
    const input = screen.getByLabelText("some field");
    fireEvent.keyDown(input, { key: "v" });
    expect(screen.queryByTestId("versions-panel-stub")).toBeNull();
  });
});
