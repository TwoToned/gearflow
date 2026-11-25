// @vitest-environment jsdom
//
// UX Phase 7: the job page header. Every overlay is OPENED, not just rendered
// closed (CLAUDE.md): Documents ▾ (+ a label submenu), the header ⋯ (+ the
// Version submenu and the Cancel confirm), the lock glyph menu (+ the Unlock
// confirm), `Set status ▾`, the Comments panel from ⋯, `V`, and the phone
// bottom sheets.
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

let mockIsMobile = false;
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mockIsMobile }));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));

let perms: Record<string, boolean> = {};
vi.mock("@/lib/use-permissions", () => ({ useCanDo: (r: string, a: string) => perms[`${r}:${a}`] ?? true }));

const VERSIONS = [
  { id: "v3", number: 3, isLive: true, contentState: "ready" as const, createdAt: 2, createdById: "u1" },
  { id: "v2", number: 2, label: "Option B", isLive: false, contentState: "ready" as const, createdAt: 1, createdById: "u1" },
];
let versionCtx: Record<string, unknown> = {};
vi.mock("@/components/projects/project-version-context", async () => {
  const actual = await vi.importActual<typeof import("@/components/projects/project-version-context")>(
    "@/components/projects/project-version-context",
  );
  return { ...actual, useProjectVersion: () => versionCtx };
});
vi.mock("@/hooks/use-project-version-writes", () => ({
  useProjectVersionWrites: () => ({ createVersion: vi.fn(async () => ({ id: "v4", number: 4 })) }),
}));

let lock = { loading: false, pricingLocked: false, canUnlockPricing: true, pricingLockedByName: "Bob" as string | undefined };
const unlock = vi.fn(async () => ({ undoToken: "u1" }));
const undoUnlock = vi.fn(async () => {});
vi.mock("@/hooks/use-project-lock", () => ({
  useProjectPricingLock: () => ({ ...lock, lock: vi.fn(), unlock, undoUnlock }),
}));

vi.mock("@/hooks/use-authed-query", () => ({ useAuthedQuery: () => ({ count: 2 }) }));

const labelEnabled: boolean[] = [];
const openLabel = vi.fn();
vi.mock("@/components/documents/label-submenu", () => ({
  useLabelIndex: (_p: string, _t: string, enabled: boolean) => {
    labelEnabled.push(enabled);
    return enabled ? { status: "ready", labels: [{ id: "k1", title: "Truss kit", tag: "K-1" }] } : { status: "idle" };
  },
  openLabel: (...a: unknown[]) => openLabel(...a),
}));

const updateStatus = vi.fn(async () => {});
const archive = vi.fn(async () => {});
vi.mock("@/hooks/use-native-project-writes", () => ({
  useNativeProjectStatus: () => ({ updateStatus }),
  useProjectWrites: () => ({ archive, remove: vi.fn(async () => ({ freedAssets: 0, freedKits: 0 })) }),
}));
vi.mock("@/hooks/use-confirm-status-gate", () => ({
  useConfirmStatusGate: (_o: string, onProceed: (p: string, s: string) => void) => ({
    requestStatusChange: async (p: string, _c: string, s: string) => onProceed(p, s),
    checking: false,
    pending: null,
    confirmPending: vi.fn(),
    cancelPending: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-project-detail", () => ({ refreshProjectDetail: vi.fn() }));
vi.mock("@/lib/confetti", () => ({ fireConfettiFromElement: vi.fn() }));

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));

// Heavy dialogs have their own tests; stubs prove they open.
// The discussion count badge has its own read; here it is a stub that proves it jumps.
vi.mock("@/components/projects/discussion-badge", () => ({
  DiscussionBadge: ({ onOpen }: { onOpen: () => void }) => (
    <button type="button" onClick={onOpen}>
      discussion badge
    </button>
  ),
}));
vi.mock("@/components/projects/call-sheet-dialog", () => ({
  CallSheetDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="call-sheet" /> : null),
}));
vi.mock("@/components/projects/duplicate-project-dialog", () => ({
  DuplicateProjectDialog: ({ mode }: { mode: string }) => <div data-testid={`dup-${mode}`} />,
}));
vi.mock("@/components/projects/payment-progress-strip", () => ({ PaymentProgressStrip: () => null }));
vi.mock("@/components/projects/confirm-status-impact-dialog", () => ({ ConfirmStatusImpactDialog: () => null }));

import { JobHeader, type JobHeaderProject } from "@/components/projects/job-header";

const PROJECT: JobHeaderProject = {
  id: "p1",
  name: "Hilton gala",
  status: "CONFIRMED",
  isTemplate: false,
  projectNumber: "#2341",
  client: { id: "c1", name: "Hilton" },
  rentalStartDate: "2026-11-12T00:00:00",
  rentalEndDate: "2026-11-14T00:00:00",
};

function setup(over: Partial<JobHeaderProject> = {}) {
  const onOpenTab = vi.fn();
  const onOpenVersions = vi.fn();
  const onMakeLive = vi.fn();
  const onOpenDiscussion = vi.fn();
  render(<JobHeader project={{ ...PROJECT, ...over }} orgId="org1" onOpenTab={onOpenTab} onOpenVersions={onOpenVersions} onMakeLive={onMakeLive} onOpenDiscussion={onOpenDiscussion} />);
  return { onOpenTab, onOpenVersions, onMakeLive, onOpenDiscussion };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockIsMobile = false;
  perms = {};
  labelEnabled.length = 0;
  lock = { loading: false, pricingLocked: false, canUnlockPricing: true, pricingLockedByName: "Bob" };
  versionCtx = {
    projectId: "p1",
    versions: VERSIONS,
    liveVersion: VERSIONS[0],
    viewingNumber: null,
    isViewingVersion: false,
    viewingVersion: null,
    viewingQuoteDrift: null,
    setViewingNumber: vi.fn(),
    openCompare: vi.fn(),
  };
});

describe("JobHeader", () => {
  it("renders the calm header: title, status word, number · client · dates · days, Advance, progress", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Hilton gala" })).toBeTruthy();
    expect(document.querySelector("[data-intent]")?.textContent).toContain("Confirmed");
    expect(screen.getByText("#2341")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Hilton" }).getAttribute("href")).toBe("/clients/c1");
    expect(screen.getByText(/· 3 days$/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Advance to Prep" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Progress" })).toBeTruthy();
    // No chips: the version is not in the header row.
    expect(screen.queryByText(/v3 · Live/)).toBeNull();
  });

  it("Advance runs the status gate and toasts the move", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Advance to Prep" }));
    await waitFor(() => expect(updateStatus).toHaveBeenCalledWith("p1", "PREPPING"));
    expect(toastSuccess).toHaveBeenCalledWith("Moved to Prepping");
  });

  it("Documents ▾ opens, loads the label lists only then, and opens a label", async () => {
    setup();
    expect(labelEnabled.every((e) => !e)).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: /Documents/ }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Manifest" })).toBeTruthy();
    expect(within(menu).queryByRole("menuitem", { name: /^Quote$|^Invoice$/ })).toBeNull();
    await waitFor(() => expect(labelEnabled.at(-1)).toBe(true));
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Kit labels" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Truss kit (K-1)" }));
    expect(openLabel).toHaveBeenCalledWith("p1", "kit-label", "k1");
  });

  it("⋯ opens: Comments (with the blocking count) jumps to the Discussion section of Tasks & notes", async () => {
    const { onOpenDiscussion } = setup();
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Comments & discussion · 2 blocking" }));
    expect(onOpenDiscussion).toHaveBeenCalledTimes(1);
  });

  it("the discussion count badge jumps to the same section", async () => {
    const { onOpenDiscussion } = setup();
    await userEvent.click(screen.getByRole("button", { name: "discussion badge" }));
    expect(onOpenDiscussion).toHaveBeenCalledTimes(1);
  });

  it("⋯ › Version submenu switches versions and Manage opens Versions", async () => {
    const { onOpenVersions } = setup();
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Version v3 · Live/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "v2 · Draft · Option B" }));
    expect(versionCtx.setViewingNumber).toHaveBeenCalledWith(2);
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Version v3 · Live/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Manage versions…/ }));
    expect(onOpenVersions).toHaveBeenCalled();
  });

  it("⋯ › Cancel job asks first, then cancels", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Cancel job…" }));
    expect(await screen.findByText("Cancel this job?")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel job" }));
    await waitFor(() => expect(archive).toHaveBeenCalledWith("p1"));
  });

  it("the lock glyph opens its menu; Unlock confirms, toasts, and its Undo reverses exactly that unlock", async () => {
    lock = { ...lock, pricingLocked: true };
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Pricing locked" }));
    expect(await screen.findByText(/A quote has been sent or this job is confirmed by Bob/)).toBeTruthy();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Unlock pricing" }));
    expect(await screen.findByText("Unlock pricing?")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Unlock pricing" }));
    await waitFor(() => expect(unlock).toHaveBeenCalled());
    const [, opts] = toastSuccess.mock.calls.find((c) => c[0] === "Pricing unlocked")!;
    (opts as { action: { onClick: () => void } }).action.onClick();
    await waitFor(() => expect(undoUnlock).toHaveBeenCalledWith("u1"));
  });

  it("someone outside the unlock audience still gets the glyph, without Unlock", async () => {
    lock = { ...lock, pricingLocked: true, canUnlockPricing: false };
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Pricing locked" }));
    expect(await screen.findByRole("menuitem", { name: "Quotes and invoices" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Unlock pricing" })).toBeNull();
  });

  it("Set status ▾ opens and moves through the same gate", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /Set status/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Awaiting payment" }));
    await waitFor(() => expect(updateStatus).toHaveBeenCalledWith("p1", "AWAITING_PAYMENT"));
  });

  it("without project:update there is no Advance, Set status, Edit or Cancel", async () => {
    perms = { "project:update": false };
    setup();
    expect(screen.queryByRole("button", { name: /Advance/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Set status/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await screen.findByRole("menu");
    expect(screen.queryByRole("menuitem", { name: "Cancel job…" })).toBeNull();
  });

  it("V opens Versions; typing in an input does not", async () => {
    const { onOpenVersions } = setup();
    await userEvent.keyboard("v");
    expect(onOpenVersions).toHaveBeenCalledTimes(1);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    await userEvent.keyboard("v");
    expect(onOpenVersions).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it("a cancelled job shows the off-pipeline notice with Set status and Delete", async () => {
    setup({ status: "CANCELLED" });
    expect(screen.getByText(/off the pipeline/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Progress" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Delete job…" }));
    expect(await screen.findByText("Delete job?")).toBeTruthy();
  });

  it("viewing a draft shows the quiet strip with Make live and Back to live", async () => {
    versionCtx = { ...versionCtx, isViewingVersion: true, viewingNumber: 2, viewingVersion: VERSIONS[1] };
    const { onMakeLive } = setup();
    expect(screen.getByText(/Viewing v2 · Option B/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Make v2 live" }));
    expect(onMakeLive).toHaveBeenCalledWith(VERSIONS[1]);
    await userEvent.click(screen.getByRole("button", { name: /Back to live/ }));
    expect(versionCtx.setViewingNumber).toHaveBeenCalledWith(null);
  });

  it("a template: Template word and Use template, no Documents or ⋯", async () => {
    setup({ isTemplate: true, status: "ENQUIRY" });
    expect(screen.getByText("Template")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Documents/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Use template" }));
    expect(screen.getByTestId("dup-duplicate")).toBeTruthy();
  });

  it("on a phone: Advance is full-width under the progress line, and ⋯ is a bottom sheet", async () => {
    mockIsMobile = true;
    setup();
    const advance = screen.getByRole("button", { name: "Advance to Prep" });
    expect(advance.className).toMatch(/w-full/);
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(await screen.findByRole("button", { name: "Runsheet" })).toBeTruthy();
  });
});
