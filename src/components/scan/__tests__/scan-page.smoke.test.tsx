// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  nav: { search: "", listeners: new Set<() => void>() },
  cards: {} as Record<string, unknown>,
  items: [] as unknown[],
  save: vi.fn(),
  undo: vi.fn(),
  testCards: {} as Record<string, unknown>,
  record: vi.fn(),
  undoRecord: vi.fn(),
  ttCreate: vi.fn(),
  ttRemove: vi.fn(),
  ttReactivate: vi.fn(),
  ttRetire: vi.fn(),
  convexQuery: vi.fn(),
  mxCreate: vi.fn(),
  mxRemove: vi.fn(),
  mxUndo: vi.fn(),
  toasts: [] as Array<{ title: string; action?: { label: string; onClick: () => void } }>,
  info: vi.fn(),
  perms: { warehouse: ["read", "scan"], testTag: ["read", "create"], asset: ["read", "create"], checkItem: ["read"] } as Record<string, string[]>,
}));

function setUrl(href: string) {
  h.nav.search = href.split("?")[1] ?? "";
  h.nav.listeners.forEach((l) => l());
}
const replace = vi.fn((href: string) => setUrl(href));
const push = vi.fn();

vi.mock("next/navigation", async () => {
  const R = await vi.importActual<typeof import("react")>("react");
  return {
    useSearchParams: () => {
      const s = R.useSyncExternalStore(
        (l) => {
          h.nav.listeners.add(l);
          return () => h.nav.listeners.delete(l);
        },
        () => h.nav.search,
      );
      return R.useMemo(() => new URLSearchParams(s), [s]);
    },
    useRouter: () => ({ replace, push }),
    usePathname: () => "/scan",
  };
});
vi.mock("@/hooks/use-authed-query", () => ({
  useAuthedQuery: (fn: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(fn as Parameters<typeof getFunctionName>[0]);
    if (name === "scanLookup:checkCard") return h.cards[(args as { value: string }).value];
    if (name === "scanLookup:testCard") return h.testCards[(args as { value: string }).value];
    if (name === "modelCheckItems:assignmentsForModel") return h.items;
    return undefined;
  },
}));
vi.mock("@/hooks/use-check-record-writes", () => ({
  useCheckRecordWrites: () => ({ saveAdHocCheck: h.save, undoAdHocCheck: h.undo }),
}));
vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org_1" } }),
  useSession: () => ({ data: { user: { id: "u1", name: "Sam Tester" } } }),
}));
vi.mock("@/hooks/use-member-roster", () => ({
  useMemberRoster: () => ({ nameOf: new Map([["u1", "Sam Tester"], ["u2", "Kim"]]), options: [{ id: "u1", name: "Sam Tester" }, { id: "u2", name: "Kim" }] }),
}));
vi.mock("@/hooks/use-test-tag-writes", () => ({
  useTestTagWrites: () => ({ recordTest: h.record, undoRecordTest: h.undoRecord, create: h.ttCreate, remove: h.ttRemove, reactivate: h.ttReactivate, retire: h.ttRetire }),
}));
vi.mock("convex/react", () => ({ useConvex: () => ({ query: h.convexQuery }) }));
vi.mock("@/hooks/use-maintenance-writes", () => ({ useMaintenanceWrites: () => ({ create: h.mxCreate, undoCreate: h.mxUndo, remove: h.mxRemove }) }));
vi.mock("@/lib/use-permissions", () => ({
  useCurrentRole: () => ({ permissions: h.perms, isLoading: false }),
  useCanDo: (r: string, a: string) => h.perms[r]?.includes(a) ?? false,
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-stable-now", () => ({ useStableNow: () => Date.UTC(2026, 10, 22) }));
vi.mock("@/lib/scan-feedback", () => ({ playScanFeedback: vi.fn(), playScanHaptic: vi.fn() }));
vi.mock("@/components/layout/page-meta", () => ({ PageMeta: () => null }));
vi.mock("@/components/scanner/camera-scanner-dialog", () => ({
  CameraScannerDialog: ({ open, title }: { open: boolean; title: string }) => (open ? <div role="dialog">{title}</div> : null),
}));
vi.mock("@/components/ui/photo-grid-input", () => ({
  PhotoGridInput: ({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) => (
    <button type="button" onClick={() => onChange([...value, "https://x/p.jpg"])}>Add photo</button>
  ),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: (title: string, opts?: { action?: { label: string; onClick: () => void } }) => h.toasts.push({ title, action: opts?.action }),
    error: (title: string) => h.toasts.push({ title }),
    info: (title: string) => h.info(title),
    warning: vi.fn(),
  }),
}));

import { ScanPage } from "@/components/scan/scan-page";
import { ScanTargetProvider, useScanTargetReader } from "@/components/scanner/scan-target";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const item = (id: string, label: string) => ({
  id: "a-" + id, sortOrder: 0,
  checkItem: { id, label, description: null, type: "PASS_FAIL", category: null, measurementUnit: null, measurementMin: null, measurementMax: null, dropdownOptions: null },
});
const assetCard = (tag: string, patch: Record<string, unknown> = {}) => ({
  kind: "asset", tag,
  asset: { id: "id-" + tag, assetTag: tag, serialNumber: "SN1", modelId: "m1", modelName: "Aura Wash", status: "AVAILABLE", condition: "GOOD" },
  kit: null, bulk: null, location: { id: "loc1", name: "Warehouse A" }, job: null,
  lastCheck: null, checkItemCount: 2, tt: null, ...patch,
});
const unknownCard = (tag: string) => ({ kind: "unknown", tag, asset: null, kit: null, bulk: null, location: null, job: null, lastCheck: null, checkItemCount: 0, tt: null });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const saveButton = () => screen.getByRole("button", { name: "Save and scan next" });

beforeEach(() => {
  vi.clearAllMocks();
  h.nav.search = "";
  h.toasts.length = 0;
  h.items = [item("power", "Power on"), item("yoke", "Yoke")];
  h.cards = { "AURA-01": assetCard("AURA-01"), "AURA-02": assetCard("AURA-02"), "ZZ-9": unknownCard("ZZ-9") };
  h.perms = { warehouse: ["read", "scan"], testTag: ["read", "create"], asset: ["read", "create"], checkItem: ["read"], maintenance: ["create", "delete"] };
});

describe("ScanPage — Create maintenance job", () => {
  async function failYoke() {
    const yoke = screen.getByText("Yoke").closest("[data-check-item]") as HTMLElement;
    await userEvent.click(within(yoke).getByRole("button", { name: "Fail" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Pass all" })[0]);
    await userEvent.type(within(yoke).getByPlaceholderText("Describe the failure..."), "Tilt lock slips");
    await userEvent.click(within(yoke).getByRole("button", { name: "Add photo" }));
  }

  it("the save caret's 'Save and create maintenance job' saves first, then opens the dialog prefilled; Undo deletes exactly that job", async () => {
    setUrl("/scan?mode=check&tag=AURA-01");
    h.save.mockResolvedValueOnce({ success: true, recordIds: ["r1", "r2"], auditId: "aud9", condition: "DAMAGED" });
    h.mxCreate.mockResolvedValueOnce({ id: "mx1" });
    h.mxUndo.mockResolvedValue({ ok: true });
    render(<ScanPage />);
    await failYoke();
    await userEvent.click(screen.getByRole("button", { name: "More ways to save" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Save and create maintenance job" }));
    expect(h.save).toHaveBeenCalledTimes(1);
    const dialog = await screen.findByRole("dialog", { name: "Create maintenance job" });
    expect(within(dialog).getByLabelText("Title")).toHaveProperty("value", "Repair — AURA-01");
    expect(within(dialog).getByLabelText("What failed")).toHaveProperty("value", "Yoke: Tilt lock slips");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create job" }));
    expect(h.mxCreate).toHaveBeenCalledWith({ assetId: "id-AURA-01", type: "REPAIR", status: "SCHEDULED", title: "Repair — AURA-01", description: "Yoke: Tilt lock slips" });
    const toast = h.toasts.find((t) => t.title === "Maintenance job created for AURA-01");
    await act(async () => toast!.action!.onClick());
    await act(async () => toast!.action!.onClick()); // the ONE guarded closure: a second click does nothing
    expect(h.mxUndo).toHaveBeenCalledTimes(1);
    expect(h.mxUndo).toHaveBeenCalledWith("mx1"); // the guarded exact reverse
    expect(h.mxRemove).not.toHaveBeenCalled(); // never a bare delete
  });

  it("the card ⋯ opens the dialog; a passing check offers no 'Save and create maintenance job'; the Undo needs only maintenance:create", async () => {
    h.perms = { ...h.perms, maintenance: ["create"] };
    setUrl("/scan?mode=check&tag=AURA-01");
    h.mxCreate.mockResolvedValueOnce({ id: "mx2" });
    render(<ScanPage />);
    await userEvent.click(screen.getAllByRole("button", { name: "Pass all" })[0]);
    await userEvent.click(screen.getByRole("button", { name: "More ways to save" }));
    expect(await screen.findByRole("menuitem", { name: "Save and keep this asset open" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Save and create maintenance job" })).toBeNull();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Scan actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Create maintenance job…" }));
    const dialog = await screen.findByRole("dialog", { name: "Create maintenance job" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Create job" }));
    expect(h.mxCreate).toHaveBeenCalledTimes(1);
    // undoCreateNative is gated on maintenance:create (the author's own write), not delete.
    const toast = h.toasts.find((t) => t.title === "Maintenance job created for AURA-01");
    h.mxUndo.mockResolvedValue({ ok: true });
    await act(async () => toast!.action!.onClick());
    expect(h.mxUndo).toHaveBeenCalledWith("mx2");
  });

  it("absent without maintenance:create", async () => {
    h.perms = { ...h.perms, maintenance: [] };
    setUrl("/scan?mode=check&tag=AURA-01");
    render(<ScanPage />);
    await userEvent.click(screen.getByRole("button", { name: "Scan actions" }));
    expect(await screen.findByRole("menuitem", { name: "Open asset" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Create maintenance job…" })).toBeNull();
  });
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ScanPage — Check mode", () => {
  it("starts Ready; the dock's Enter loads the tag through the URL; camera opens from the tap", async () => {
    render(<ScanPage />);
    expect(screen.getByText("Scan a tag to check it")).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Scan mode" })).toBeNull(); // no mode words in the dock
    await userEvent.type(screen.getByLabelText("Scan input"), "AURA-01{Enter}");
    expect(replace).toHaveBeenLastCalledWith("/scan?mode=check&tag=AURA-01", { scroll: false });
    expect(await screen.findByText("Aura Wash")).toBeTruthy();
    expect(screen.getByText("Warehouse A")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Scan a tag with the camera" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("a deep link loads the tag; a modes word list shows both modes the user holds", () => {
    setUrl("/scan?mode=check&tag=AURA-01");
    render(<ScanPage />);
    expect(screen.getByText("Aura Wash")).toBeTruthy();
    const words = screen.getByRole("toolbar", { name: "Scan mode" });
    expect(within(words).getByRole("button", { name: /Check/ })).toBeTruthy();
    expect(within(words).getByRole("button", { name: /Test & tag/ })).toBeTruthy();
  });

  it("only the modes held are shown; no mode held is denied", () => {
    h.perms = { warehouse: ["read", "scan"] };
    const { unmount } = render(<ScanPage />);
    expect(screen.queryByRole("toolbar", { name: "Scan mode" })).toBeNull();
    unmount();
    h.perms = { warehouse: ["read"] };
    render(<ScanPage />);
    expect(screen.getByText("Access Denied")).toBeTruthy();
  });

  it("save is disabled with the reason in plain words until every item is answered", async () => {
    setUrl("/scan?mode=check&tag=AURA-01");
    render(<ScanPage />);
    expect(saveButton()).toHaveProperty("disabled", true);
    expect(screen.getByText("Answer Power on")).toBeTruthy();
    const yoke = screen.getByText("Yoke").closest("[data-check-item]") as HTMLElement;
    await userEvent.click(within(yoke).getByRole("button", { name: "Fail" }));
    expect(screen.getByText("Answer Power on")).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: "Pass all" })[0]);
    expect(screen.getByText("Yoke needs a reason and a photo")).toBeTruthy();
    // A fail forces and locks the condition to Damaged.
    const condition = screen.getByRole("radiogroup", { name: "Condition" });
    expect(within(condition).getByRole("radio", { name: "Damaged" }).getAttribute("aria-checked")).toBe("true");
    expect(within(condition).getByRole("radio", { name: "Good" })).toHaveProperty("disabled", true);
    expect(screen.getByText(/Locked to Damaged/)).toBeTruthy();
    await userEvent.type(within(yoke).getByPlaceholderText("Describe the failure..."), "Cracked");
    await userEvent.click(within(yoke).getByRole("button", { name: "Add photo" }));
    expect(saveButton()).toHaveProperty("disabled", false);
  });

  it("save AWAITS the mutation: the card stays while pending, then clears; ONE undo closure for toast and row", async () => {
    setUrl("/scan?mode=check&tag=AURA-01");
    const pending = deferred<{ success: true; recordIds: string[]; auditId: string; condition: string }>();
    h.save.mockReturnValueOnce(pending.promise);
    h.undo.mockResolvedValue({ ok: true });
    render(<ScanPage />);
    await userEvent.click(screen.getAllByRole("button", { name: "Pass all" })[0]);
    await userEvent.click(saveButton());
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ assetId: "id-AURA-01", condition: "GOOD" }));
    expect(screen.getByText("Aura Wash")).toBeTruthy(); // still loaded while pending
    expect(replace).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ success: true, recordIds: ["r1", "r2"], auditId: "aud1", condition: "GOOD" }));
    expect(replace).toHaveBeenLastCalledWith("/scan?mode=check", { scroll: false });
    expect(screen.getByText("Scan a tag to check it")).toBeTruthy();

    const toast = h.toasts.find((t) => t.title === "Saved check on AURA-01");
    expect(toast?.action?.label).toBe("Undo");
    const rows = screen.getByRole("list", { name: "Recent scans" });
    await userEvent.click(within(rows).getByRole("button", { name: "Undo" }));
    // The toast's Undo is the SAME guarded closure: a second click does nothing.
    await act(async () => toast!.action!.onClick());
    expect(h.undo).toHaveBeenCalledTimes(1);
    expect(h.undo).toHaveBeenCalledWith("aud1");
    // Nothing else was loaded, so the draft comes back with its tag.
    expect(replace).toHaveBeenLastCalledWith("/scan?mode=check&tag=AURA-01", { scroll: false });
  });

  it("a failed check with a photo still has its Undo; the draft comes back without the photo", async () => {
    setUrl("/scan?mode=check&tag=AURA-01");
    h.save.mockResolvedValueOnce({ success: true, recordIds: ["r1", "r2"], auditId: "aud2", condition: "DAMAGED" });
    h.undo.mockResolvedValue({ ok: true, photosDeleted: 1 });
    render(<ScanPage />);
    const yoke = () => screen.getByText("Yoke").closest("[data-check-item]") as HTMLElement;
    await userEvent.click(within(yoke()).getByRole("button", { name: "Fail" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Pass all" })[0]);
    await userEvent.type(within(yoke()).getByPlaceholderText("Describe the failure..."), "Cracked");
    await userEvent.click(within(yoke()).getByRole("button", { name: "Add photo" }));
    await userEvent.click(saveButton());
    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ condition: "DAMAGED" }));
    const rows = await screen.findByRole("list", { name: "Recent scans" });
    await userEvent.click(within(rows).getByRole("button", { name: "Undo" }));
    expect(h.undo).toHaveBeenCalledWith("aud2");
    expect(h.toasts.map((t) => t.title)).toContain("Undone · photos need re-adding");
    // Restored: the reason is back, the photo is not.
    expect(within(yoke()).getByPlaceholderText("Describe the failure...")).toHaveProperty("value", "Cracked");
    expect(screen.getByText("Yoke needs a photo")).toBeTruthy();
  });

  it("SF3: a scan mid-save loads the next item at once (no Discard prompt), and the landing save leaves it and its answers alone", async () => {
    setUrl("/scan?mode=check&tag=AURA-01");
    const pending = deferred<{ success: true; recordIds: string[]; auditId: string; condition: string }>();
    h.save.mockReturnValueOnce(pending.promise);
    render(<ScanPage />);
    await userEvent.click(screen.getAllByRole("button", { name: "Pass all" })[0]);
    await userEvent.click(saveButton());
    await userEvent.type(screen.getByLabelText("Scan input"), "AURA-02{Enter}");
    expect(screen.queryByRole("dialog", { name: "Discard this check?" })).toBeNull();
    expect(replace).toHaveBeenLastCalledWith("/scan?mode=check&tag=AURA-02", { scroll: false });
    await userEvent.click(screen.getAllByRole("button", { name: "Pass all" })[0]);
    await act(async () => pending.resolve({ success: true, recordIds: ["r1"], auditId: "aud5", condition: "GOOD" }));
    // B is still loaded, with its answers.
    expect(replace).toHaveBeenLastCalledWith("/scan?mode=check&tag=AURA-02", { scroll: false });
    expect(saveButton()).toHaveProperty("disabled", false);
  });

  it("SF5: Pass all's Undo un-answers only what Pass all set and still reads Pass; a later Fail and its note survive", async () => {
    setUrl("/scan?mode=check&tag=AURA-01");
    render(<ScanPage />);
    const row = (label: string) => screen.getByText(label).closest("[data-check-item]") as HTMLElement;
    await userEvent.click(screen.getAllByRole("button", { name: "Pass all" })[0]);
    await userEvent.click(within(row("Yoke")).getByRole("button", { name: "Fail" }));
    await userEvent.type(within(row("Yoke")).getByPlaceholderText("Describe the failure..."), "Slips");
    const toast = h.toasts.find((t) => t.title === "All pass/fail items marked Pass");
    await act(async () => toast!.action!.onClick());
    expect(within(row("Power on")).getByRole("button", { name: "Pass" }).getAttribute("aria-pressed")).toBe("false");
    expect(within(row("Yoke")).getByRole("button", { name: "Fail" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(row("Yoke")).getByPlaceholderText("Describe the failure...")).toHaveProperty("value", "Slips");
  });

  it("a failed save keeps the card and its answers", async () => {
    setUrl("/scan?mode=check&tag=AURA-01");
    h.save.mockRejectedValueOnce(new Error("Network down"));
    render(<ScanPage />);
    await userEvent.click(screen.getAllByRole("button", { name: "Pass all" })[0]);
    await userEvent.click(saveButton());
    expect(screen.getByText("Aura Wash")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
    expect(saveButton()).toHaveProperty("disabled", false); // answers kept
  });

  it("a scan over unsaved answers asks to discard; Keep keeps them, Discard loads the new tag", async () => {
    setUrl("/scan?mode=check&tag=AURA-01");
    render(<ScanPage />);
    await userEvent.click(screen.getAllByRole("button", { name: "Pass all" })[0]);
    await userEvent.type(screen.getByLabelText("Scan input"), "AURA-02{Enter}");
    let dialog = await screen.findByRole("dialog", { name: "Discard this check?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep checking" }));
    expect(replace).not.toHaveBeenCalled();
    expect(saveButton()).toHaveProperty("disabled", false);
    await userEvent.type(screen.getByLabelText("Scan input"), "AURA-02{Enter}");
    dialog = await screen.findByRole("dialog", { name: "Discard this check?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
    expect(replace).toHaveBeenLastCalledWith("/scan?mode=check&tag=AURA-02", { scroll: false });
  });

  it("the same tag again toasts `already open`", async () => {
    setUrl("/scan?mode=check&tag=AURA-01");
    render(<ScanPage />);
    await userEvent.type(screen.getByLabelText("Scan input"), "AURA-01{Enter}");
    expect(h.info).toHaveBeenCalledWith("AURA-01 is already open");
    expect(replace).not.toHaveBeenCalled();
  });

  it("a tag the URL rule refuses is reported — toast, exception sound, Last scans row — never dropped (SF4)", async () => {
    const { playScanFeedback } = await import("@/lib/scan-feedback");
    render(<ScanPage />);
    await userEvent.type(screen.getByLabelText("Scan input"), "AB#CD{Enter}");
    expect(h.toasts.map((t) => t.title)).toContain("Can't read tag AB#CD");
    expect(playScanFeedback).toHaveBeenCalledWith("exception");
    const rows = await screen.findByRole("list", { name: "Recent scans" });
    expect(within(rows).getByText(/Can't read this tag/)).toBeTruthy();
    expect(within(rows).getByRole("button", { name: "AB#CD" })).toBeTruthy();
    expect(replace).not.toHaveBeenCalled(); // nothing loads
  });

  it("an old link carrying an unreadable tag is reported once, then dropped from the URL (SF4)", async () => {
    const { playScanFeedback } = await import("@/lib/scan-feedback");
    setUrl("/scan?mode=check&tag=%3Cscript%3E");
    render(<ScanPage />);
    const rows = await screen.findByRole("list", { name: "Recent scans" });
    expect(within(rows).getByText(/Can't read this tag/)).toBeTruthy();
    expect(h.toasts.filter((t) => t.title === "Can't read tag <script>")).toHaveLength(1);
    expect(playScanFeedback).toHaveBeenCalledWith("exception");
    expect(replace).toHaveBeenLastCalledWith("/scan?mode=check", { scroll: false });
  });

  it("an unknown tag shows its state, is logged in Last scans, and a row tap scans again", async () => {
    setUrl("/scan?mode=check&tag=ZZ-9");
    render(<ScanPage />);
    expect(screen.getByText("No asset carries this tag")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Register an asset with this tag" })).toBeTruthy();
    const rows = await screen.findByRole("list", { name: "Recent scans" });
    expect(within(rows).getByText(/No asset carries this tag/)).toBeTruthy();
    await userEvent.click(within(rows).getByRole("button", { name: "ZZ-9" }));
    expect(h.info).toHaveBeenCalledWith("ZZ-9 is already open"); // same tag → the one scan() path
  });

  it("the bottom-nav Scan lands in the page's scan(), not the shell lookup", async () => {
    let reader: (() => ((v: string) => void) | null) | null = null;
    function Probe() {
      reader = useScanTargetReader();
      return null;
    }
    render(
      <ScanTargetProvider>
        <ScanPage />
        <Probe />
      </ScanTargetProvider>,
    );
    act(() => reader!()!("AURA-01"));
    expect(replace).toHaveBeenLastCalledWith("/scan?mode=check&tag=AURA-01", { scroll: false });
  });
});

describe("ScanPage — overlays open", () => {
  // Radix Select needs pointer-capture / scrollIntoView shims in jsdom.
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.setPointerCapture ??= () => {};
    Element.prototype.releasePointerCapture ??= () => {};
    Element.prototype.scrollIntoView ??= () => {};
  });

  it("a SELECT-type check item opens its options; a fail option fails the item and asks for a reason", async () => {
    h.items = [
      item("power", "Power on"),
      {
        id: "a-lens", sortOrder: 1,
        checkItem: {
          id: "lens", label: "Lens", description: null, type: "DROPDOWN", category: null, measurementUnit: null, measurementMin: null, measurementMax: null,
          dropdownOptions: [{ label: "Clean", isFail: false }, { label: "Cracked", isFail: true }],
        },
      },
    ];
    setUrl("/scan?mode=check&tag=AURA-01");
    render(<ScanPage />);
    const lens = screen.getByText("Lens").closest("[data-check-item]") as HTMLElement;
    await userEvent.click(within(lens).getByRole("combobox"));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByRole("option", { name: /Clean/ })).toBeTruthy();
    await userEvent.click(within(listbox).getByRole("option", { name: /Cracked/ }));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(within(lens).getByRole("combobox").textContent).toContain("Cracked");
    expect(within(lens).getByPlaceholderText("Describe the failure...")).toBeTruthy();
  });

  it("Discard over a mode change: Esc keeps the answers and the mode; Discard then switches", async () => {
    setUrl("/scan?mode=check&tag=AURA-01");
    render(<ScanPage />);
    await userEvent.click(screen.getAllByRole("button", { name: "Pass all" })[0]);
    const words = screen.getByRole("toolbar", { name: "Scan mode" });
    await userEvent.click(within(words).getByRole("button", { name: /Test & tag/ }));
    await screen.findByRole("dialog", { name: "Discard this check?" });
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Discard this check?" })).toBeNull();
    expect(replace).not.toHaveBeenCalled();
    expect(saveButton()).toHaveProperty("disabled", false); // answers kept, still Check mode
    await userEvent.click(within(words).getByRole("button", { name: /Test & tag/ }));
    const dialog = await screen.findByRole("dialog", { name: "Discard this check?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
    expect(replace).toHaveBeenLastCalledWith("/scan?mode=tt&tag=AURA-01", { scroll: false });
  });

  it("page ⋯, card ⋯, Last scans row ⋯ and the save caret all open", async () => {
    setUrl("/scan?mode=check&tag=ZZ-9");
    const { unmount } = render(<ScanPage />);
    await userEvent.click(screen.getByRole("button", { name: "Scan page actions" }));
    expect(await screen.findByRole("menuitem", { name: "Scan sounds: On" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Clear last scans" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(await screen.findByRole("button", { name: "Actions for ZZ-9" }));
    expect(await screen.findByRole("menuitem", { name: "Scan it again" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    unmount();

    setUrl("/scan?mode=check&tag=AURA-01");
    render(<ScanPage />);
    await userEvent.click(screen.getByRole("button", { name: "Scan actions" }));
    expect(await screen.findByRole("menuitem", { name: "Open asset" })).toBeTruthy();
    await userEvent.click(screen.getByRole("menuitem", { name: "Pass all" }));
    await userEvent.click(screen.getByRole("button", { name: "More ways to save" }));
    expect(await screen.findByRole("menuitem", { name: "Save and keep this asset open" })).toBeTruthy();
  });

  it("Clear last scans confirms before clearing", async () => {
    setUrl("/scan?mode=check&tag=ZZ-9");
    render(<ScanPage />);
    await screen.findByRole("list", { name: "Recent scans" });
    await userEvent.click(screen.getByRole("button", { name: "Scan page actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Clear last scans" }));
    const dialog = await screen.findByRole("dialog", { name: "Clear 1 last scan?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Clear" }));
    expect(screen.queryByRole("list", { name: "Recent scans" })).toBeNull();
  });
});
