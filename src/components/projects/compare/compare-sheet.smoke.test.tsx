// @vitest-environment jsdom
// UX Phase 8 (D20) — the Compare SHEET, rendered for real. It re-hosts
// `versionsRead.compareVersions` (no second diff): the side pickers OPEN, the
// stepper (n / p) and the bridge jump move focus, the sent-quote side shows the
// totals-only note, and Make live hands off. A phone gets the 92% bottom sheet.
import React from "react";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
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
const data = vi.hoisted(() => ({ value: undefined as unknown, args: undefined as unknown }));
vi.mock("@/hooks/use-authed-query", () => ({
  useAuthedQuery: (_ref: unknown, args: unknown) => {
    data.args = args;
    return args === "skip" ? undefined : data.value;
  },
}));

import { CompareSheet } from "./compare-sheet";

const V = (n: number, over: Partial<ProjectVersionSummary> = {}): ProjectVersionSummary => ({
  id: `v${n}`, number: n, isLive: false, contentState: "ready", createdAt: 1, createdById: "u1", ...over,
});
const versions = [V(1), V(2, { label: "LED wall" }), V(3, { isLive: true })];
const snap = (label: string, lineTotal: number) => ({ id: label, label, quantity: 1, unitPrice: lineTotal, discount: null, lineTotal });

const DATA = {
  a: { label: "v3 · Live", totals: { total: 21910 } },
  b: { label: "v2 · LED wall", totals: { total: 23880 } },
  rows: [
    { key: "r1", kind: "line", state: "added", categoryLabel: "Video", a: null, b: snap("LED panel", 1500) },
    { key: "r2", kind: "line", state: "changed", categoryLabel: "Lighting", a: snap("MAC Aura", 400), b: snap("MAC Aura", 470) },
    { key: "r3", kind: "line", state: "unchanged", categoryLabel: "Lighting", a: snap("Par Can", 50), b: snap("Par Can", 50) },
  ],
  bridge: {
    totalA: 21910,
    totalB: 23880,
    segments: [
      { key: "s1", state: "added", label: "1 line added", amount: 1500, rowKeys: ["r1"] },
      { key: "s2", state: "changed", label: "1 line repriced", amount: 70, rowKeys: ["r2"] },
    ],
  },
  planFieldChanges: [{ field: "crewNotes" }],
};

const props = () => ({
  open: true,
  onOpenChange: vi.fn(),
  projectId: "p1",
  orgId: "o1",
  compare: { a: { kind: "version" as const, number: null }, b: { kind: "version" as const, number: 2 } },
  versions,
  liveVersion: versions[2],
  onChangeCompare: vi.fn(),
  onMakeLive: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
  mobile.value = false;
  data.value = DATA;
});

describe("CompareSheet", () => {
  it("renders the server's rows, bridge and plan-field note inside a dialog titled Compare versions", () => {
    render(<CompareSheet {...props()} />);
    const sheet = screen.getByRole("dialog", { name: "Compare versions" });
    expect(within(sheet).getByText("Read-only. Nothing here changes the job.")).toBeTruthy();
    expect(within(sheet).getByText("LED panel")).toBeTruthy();
    expect(within(sheet).getByText("1 line added")).toBeTruthy();
    expect(within(sheet).getByText(/Other plan changes \(no money effect\): crewNotes/)).toBeTruthy();
    expect(data.args).toEqual({ organizationId: "o1", projectId: "p1", a: { kind: "version", versionId: "v3" }, b: { kind: "version", versionId: "v2" } });
  });

  it("BOTH side pickers open and change the pair", async () => {
    const user = userEvent.setup();
    const p = props();
    render(<CompareSheet {...p} />);
    await user.click(screen.getByRole("combobox", { name: "Compare to" }));
    await user.click(await screen.findByRole("option", { name: "v1" }));
    expect(p.onChangeCompare).toHaveBeenLastCalledWith({ a: p.compare.a, b: { kind: "version", number: 1 } });
    await user.click(screen.getByRole("combobox", { name: "Compare from" }));
    await user.click(await screen.findByRole("option", { name: "v2 · LED wall" }));
    expect(p.onChangeCompare).toHaveBeenLastCalledWith({ a: { kind: "version", number: 2 }, b: p.compare.b });
  });

  it("the change stepper and n / p walk the CHANGED rows only and focus them; the bridge jump focuses its first row", async () => {
    const user = userEvent.setup();
    render(<CompareSheet {...props()} />);
    expect(screen.getByText("Change 1 of 2")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next change" }));
    expect(screen.getByText("Change 2 of 2")).toBeTruthy();
    expect(document.activeElement?.textContent).toContain("MAC Aura");
    fireEvent.keyDown(window, { key: "p" });
    expect(screen.getByText("Change 1 of 2")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /1 line repriced/ }));
    expect(screen.getByText("Change 2 of 2")).toBeTruthy();
  });

  it("All rows / Only changes toggles the unchanged row", async () => {
    const user = userEvent.setup();
    render(<CompareSheet {...props()} />);
    // 3 rows (<= 40) default to All rows
    expect(screen.getByText("Par Can")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Only changes" }));
    expect(screen.queryByText("Par Can")).toBeNull();
  });

  it("a sent quote's snapshot (totals only) shows the no-rows note, not an empty table", () => {
    data.value = { ...DATA, a: { label: "Quote Q-12 (sent)", totals: { total: 21910 } }, rows: null };
    const p = props();
    render(<CompareSheet {...p} compare={{ a: { kind: "quoteSnapshot", quoteId: "q1", label: "Quote Q-12 (sent)" }, b: { kind: "version", number: 2 } }} />);
    expect(screen.getByText(/Row-level breakdown isn.t available for a sent snapshot/)).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Compare from" })).toBeNull(); // a snapshot side is fixed
    expect(data.args).toMatchObject({ a: { kind: "quoteSnapshot", quoteId: "q1" } });
  });

  it("Make v2 live closes the sheet and hands off to the one dialog; Close just closes", async () => {
    const user = userEvent.setup();
    const p = props();
    render(<CompareSheet {...p} />);
    await user.click(screen.getByRole("button", { name: /Make v2 live/ }));
    expect(p.onMakeLive).toHaveBeenCalledWith(2);
    expect(p.onOpenChange).toHaveBeenCalledWith(false);
    p.onOpenChange.mockClear();
    await user.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!); // the footer's (the sheet's X is the other)
    expect(p.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("loading shows a quiet line, and a live-vs-live compare offers no Make live", () => {
    data.value = undefined;
    const p = props();
    const { rerender } = render(<CompareSheet {...p} />);
    expect(screen.getByText(/Loading comparison/)).toBeTruthy();
    data.value = DATA;
    rerender(<CompareSheet {...p} compare={{ a: { kind: "version", number: null }, b: { kind: "version", number: null } }} />);
    expect(screen.queryByRole("button", { name: /Make .* live/ })).toBeNull();
  });

  it("phone: opens as a bottom sheet (n / p still work with a keyboard)", () => {
    mobile.value = true;
    render(<CompareSheet {...props()} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("LED panel")).toBeTruthy();
    fireEvent.keyDown(window, { key: "n" });
    expect(screen.getByText("Change 2 of 2")).toBeTruthy();
  });
});
