// @vitest-environment jsdom
// UX Phase 8 (§7b.4) — the Versions tab, rendered for real: the dated list, the
// row ⋯ (OPENED), the Rename / Save-a-copy dialogs (OPENED), the delete confirm
// and the tab-row primary. Compare and Make live hand off to the context.
import React from "react";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProjectVersionSummary } from "@/components/projects/project-version-context";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const mobile = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }));
const canPublish = vi.hoisted(() => ({ value: true }));
const canUpdate = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: (resource: string) => (resource === "invoice" ? canPublish.value : canUpdate.value) }));
vi.mock("@/hooks/use-stable-now", () => ({ useStableNow: () => 1_700_000_000_000 }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

const writes = vi.hoisted(() => ({
  createVersion: vi.fn(async () => ({ id: "v5", number: 5, auditId: "aud5" })),
  undoCreateVersion: vi.fn(async () => ({ id: "v5", number: 5 })),
  deleteVersion: vi.fn(async () => ({ id: "v1", number: 1 })),
  setLabel: vi.fn(async () => ({ id: "v2", number: 2, label: "x" })),
  makeLive: vi.fn(),
}));
vi.mock("@/hooks/use-project-version-writes", () => ({ useProjectVersionWrites: () => writes }));

const facts = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("@/hooks/use-authed-query", () => ({ useAuthedQuery: () => facts.value }));

const V = (n: number, over: Partial<ProjectVersionSummary> = {}): ProjectVersionSummary => ({
  id: `v${n}`, number: n, isLive: false, contentState: "ready", createdAt: Date.UTC(2026, 10, 6, 12), createdById: "u1", ...over,
});
const ctx = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
  setViewingNumber: vi.fn(),
  openCompare: vi.fn(),
  openMakeLive: vi.fn(),
}));
vi.mock("@/components/projects/project-version-context", () => ({ useProjectVersion: () => ctx.value }));

import { VersionsTab } from "./versions-tab";
import { VersionsTabPrimary } from "./versions-tab-primary";

beforeEach(() => {
  vi.clearAllMocks();
  mobile.value = false;
  canPublish.value = true;
  canUpdate.value = true;
  const live = V(3, { isLive: true, label: "Hilton revision" });
  ctx.value = {
    projectId: "p1",
    orgId: "o1",
    versions: [V(1), V(2, { label: "With LED wall" }), live],
    liveVersion: live,
    viewingNumber: null,
    viewingVersion: null,
    setViewingNumber: ctx.setViewingNumber,
    openCompare: ctx.openCompare,
    openMakeLive: ctx.openMakeLive,
  };
  facts.value = {
    truncated: false,
    rows: [
      { versionId: "v3", lineCount: 44, plannedCount: 36, total: 23880, quoteStatus: "SENT", diff: { vsNumber: 2, added: 2, removed: 1, changed: 3, totalDelta: 1970 } },
      { versionId: "v2", lineCount: 42, plannedCount: null, total: 21910, quoteStatus: null, diff: null },
    ],
  };
});

const setup = () => userEvent.setup();
async function openRowMenu(user: ReturnType<typeof userEvent.setup>, n: number) {
  await user.click(screen.getByRole("button", { name: `v${n} actions` }));
  return screen.findAllByRole("menuitem");
}

describe("Versions tab", () => {
  it("lists versions newest first with the dated fact line, the derived diff line and the total", () => {
    render(<VersionsTab projectId="p1" orgId="o1" />);
    const rows = within(screen.getByRole("list", { name: "Versions" })).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("v3 · Live · Hilton revision")).toBeTruthy();
    expect(within(rows[0]).getByText("44 lines · 36 planned · quote sent")).toBeTruthy();
    expect(within(rows[0]).getByText("vs v2: +2 lines · −1 line · 3 lines changed · +$1,970")).toBeTruthy();
    expect(within(rows[0]).getByText("$23,880")).toBeTruthy();
    expect(within(rows[1]).getByText("42 lines")).toBeTruthy(); // plannedCount null: not claimed
    expect(within(rows[2]).getByText("v1")).toBeTruthy(); // no facts: title and date only
  });

  it("clicking a row opens (views) that version; the live row returns to live", async () => {
    const user = setup();
    render(<VersionsTab projectId="p1" orgId="o1" />);
    await user.click(screen.getByRole("button", { name: "Open v2 · With LED wall" }));
    expect(ctx.setViewingNumber).toHaveBeenCalledWith(2);
    await user.click(screen.getByRole("button", { name: "Open v3 · Live · Hilton revision" }));
    expect(ctx.setViewingNumber).toHaveBeenCalledWith(null);
  });

  it("a draft row's ⋯: Open · Make v2 live… · Compare with v3… · Rename… · Save a copy… · Delete… (red, last)", async () => {
    const user = setup();
    render(<VersionsTab projectId="p1" orgId="o1" />);
    const items = await openRowMenu(user, 2);
    expect(items.map((i) => i.textContent)).toEqual([
      "Open this version",
      "Make v2 live…",
      "Compare with v3…",
      "Rename…",
      "Save a copy as new version…",
      "Delete…",
    ]);
  });

  it("the live row has no Delete and no Make live; Compare names the newest draft", async () => {
    const user = setup();
    render(<VersionsTab projectId="p1" orgId="o1" />);
    const items = await openRowMenu(user, 3);
    const names = items.map((i) => i.textContent);
    expect(names).not.toContain("Delete…");
    expect(names.some((n) => /Make v3 live/.test(n ?? ""))).toBe(false);
    expect(names).toContain("Compare with v2…");
  });

  it("Make live… and Compare… hand off to the ONE dialog / sheet through the context", async () => {
    const user = setup();
    render(<VersionsTab projectId="p1" orgId="o1" />);
    await openRowMenu(user, 2);
    await user.click(screen.getByRole("menuitem", { name: "Make v2 live…" }));
    expect(ctx.openMakeLive).toHaveBeenCalledWith(expect.objectContaining({ number: 2 }));
    await openRowMenu(user, 2);
    await user.click(screen.getByRole("menuitem", { name: "Compare with v3…" }));
    expect(ctx.openCompare).toHaveBeenCalledWith({ kind: "version", number: null }, { kind: "version", number: 2 });
  });

  it("Rename… opens the dialog and saves the trimmed name", async () => {
    const user = setup();
    render(<VersionsTab projectId="p1" orgId="o1" />);
    await openRowMenu(user, 2);
    await user.click(screen.getByRole("menuitem", { name: "Rename…" }));
    const dialog = await screen.findByRole("dialog", { name: /Rename v2/ });
    const input = within(dialog).getByLabelText("Version name");
    await user.clear(input);
    await user.type(input, "  Final  ");
    await user.click(within(dialog).getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(writes.setLabel).toHaveBeenCalledWith("v2", "Final"));
  });

  it("Save a copy as new version… opens the dialog; saving toasts with ONE guarded Undo (and the Undo returns the view to live)", async () => {
    ctx.value = { ...ctx.value, viewingNumber: 5 }; // the copy is on screen when Undo runs
    const user = setup();
    render(<VersionsTab projectId="p1" orgId="o1" />);
    await openRowMenu(user, 2);
    await user.click(screen.getByRole("menuitem", { name: "Save a copy as new version…" }));
    const dialog = await screen.findByRole("dialog", { name: "Save as new version" });
    expect(within(dialog).getByText(/A full copy of v2: lines, cases and the packing plan/)).toBeTruthy();
    await user.type(within(dialog).getByLabelText("Version name"), "Option B");
    await user.click(within(dialog).getByRole("button", { name: "Save as new version" }));
    await waitFor(() => expect(writes.createVersion).toHaveBeenCalledWith({ fromVersionId: "v2", label: "Option B" }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Saved v5 “Option B”", expect.objectContaining({ action: expect.anything() })));
    expect(ctx.setViewingNumber).toHaveBeenCalledWith(5);
    const undo = (toastMock.success.mock.calls.at(-1)?.[1] as { action: { onClick: () => void } }).action.onClick;
    undo();
    // GUARDED: addressed by the create's own audit id; the server refuses if the copy changed or is live.
    await waitFor(() => expect(writes.undoCreateVersion).toHaveBeenCalledWith("v5", "aud5"));
    expect(writes.deleteVersion).not.toHaveBeenCalled();
    // The version on screen was the copy: back to live, not a dead ?v=5.
    await waitFor(() => expect(ctx.setViewingNumber).toHaveBeenLastCalledWith(null));
  });

  it("an Undo the server refuses (the copy was edited) keeps the version and shows why", async () => {
    writes.undoCreateVersion.mockRejectedValueOnce(Object.assign(new Error("[CONVEX] ConvexError"), { data: { code: "VERSION_CHANGED", message: "v5 has changed since it was saved, so it was kept." } }));
    const user = setup();
    render(<VersionsTabPrimary projectId="p1" orgId="o1" />);
    await user.click(screen.getByRole("button", { name: "Save as new version" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Save as new version" })).getByRole("button", { name: "Save as new version" }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Saved v5", expect.objectContaining({ action: expect.anything() })));
    ctx.setViewingNumber.mockClear();
    (toastMock.success.mock.calls.at(-1)?.[1] as { action: { onClick: () => void } }).action.onClick();
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(ctx.setViewingNumber).not.toHaveBeenCalledWith(null); // nothing was removed
  });

  it("shows a loading state, never the empty state, while versions load", () => {
    ctx.value = { ...ctx.value, versions: [], isLoadingVersions: true };
    render(<VersionsTab projectId="p1" orgId="o1" />);
    expect(screen.getByRole("status", { name: "Loading versions" })).toBeTruthy();
    expect(screen.queryByText("No versions yet")).toBeNull();
  });

  it("Rename is gated on project:update, separately from publish", async () => {
    canUpdate.value = false;
    const user = setup();
    render(<VersionsTab projectId="p1" orgId="o1" />);
    const items = await openRowMenu(user, 2);
    expect(items.map((i) => i.textContent)).not.toContain("Rename…");
    expect(items.map((i) => i.textContent)).toContain("Make v2 live…");
  });

  it("Delete… asks first, then deletes; it is never offered without invoice:publish", async () => {
    const user = setup();
    const { unmount } = render(<VersionsTab projectId="p1" orgId="o1" />);
    await openRowMenu(user, 1);
    await user.click(screen.getByRole("menuitem", { name: "Delete…" }));
    expect(await screen.findByText("Delete v1?")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Delete version" }));
    await waitFor(() => expect(writes.deleteVersion).toHaveBeenCalledWith("v1"));
    unmount();
    canPublish.value = false;
    render(<VersionsTab projectId="p1" orgId="o1" />);
    const items = await openRowMenu(user, 1);
    expect(items.map((i) => i.textContent)).toEqual(["Open this version", "Compare with v3…", "Rename…"]); // rename is project:update; no write verbs, no Delete
  });

  it("a truncated read says facts are shown for the newest versions only", () => {
    facts.value = { truncated: true, rows: [] };
    render(<VersionsTab projectId="p1" orgId="o1" />);
    expect(screen.getByText(/shown for the newest versions only/)).toBeTruthy();
  });

  it("phone: rows open the ⋯ as a bottom sheet and the red Save as new version bar is pinned", async () => {
    mobile.value = true;
    const user = setup();
    render(<VersionsTab projectId="p1" orgId="o1" />);
    expect(screen.getByRole("button", { name: "Save as new version" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "v2 actions" }));
    expect(await screen.findByText("Make v2 live…")).toBeTruthy();
  });
});

describe("VersionsTabPrimary (the tab row's outline button)", () => {
  it("opens the Save dialog on the version on screen (live when none) and views the copy", async () => {
    const user = setup();
    render(<VersionsTabPrimary projectId="p1" orgId="o1" />);
    await user.click(screen.getByRole("button", { name: "Save as new version" }));
    const dialog = await screen.findByRole("dialog", { name: "Save as new version" });
    expect(within(dialog).getByText(/A full copy of v3/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Save as new version" }));
    await waitFor(() => expect(writes.createVersion).toHaveBeenCalledWith({ fromVersionId: "v3", label: undefined }));
    await waitFor(() => expect(ctx.setViewingNumber).toHaveBeenCalledWith(5));
  });

  it("is absent without invoice:publish", () => {
    canPublish.value = false;
    render(<VersionsTabPrimary projectId="p1" orgId="o1" />);
    expect(screen.queryByRole("button", { name: "Save as new version" })).toBeNull();
  });
});
