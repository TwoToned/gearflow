// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";

// Test & tag mode of the Scan page (Phase 16 slice 3). Same harness as
// scan-page.smoke.test.tsx: the URL is a store, Convex reads are fixtures.

const h = vi.hoisted(() => ({
  nav: { search: "", listeners: new Set<() => void>() },
  testCards: {} as Record<string, unknown>,
  record: vi.fn(),
  undoRecord: vi.fn(),
  ttCreate: vi.fn(),
  ttRemove: vi.fn(),
  ttReactivate: vi.fn(),
  ttRetire: vi.fn(),
  convexQuery: vi.fn(),
  toasts: [] as Array<{ title: string; action?: { label: string; onClick: () => void } }>,
  perms: { testTag: ["read", "create"], asset: ["read", "create"] } as Record<string, string[]>,
}));

function setUrl(href: string) {
  h.nav.search = href.split("?")[1] ?? "";
  h.nav.listeners.forEach((l) => l());
}
const replace = vi.fn((href: string) => setUrl(href));

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
    useRouter: () => ({ replace, push: vi.fn() }),
    usePathname: () => "/scan",
  };
});
vi.mock("@/hooks/use-authed-query", () => ({
  useAuthedQuery: (fn: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(fn as Parameters<typeof getFunctionName>[0]);
    return name === "scanLookup:testCard" ? h.testCards[(args as { value: string }).value] : undefined;
  },
}));
vi.mock("@/hooks/use-check-record-writes", () => ({ useCheckRecordWrites: () => ({ saveAdHocCheck: vi.fn(), undoAdHocCheck: vi.fn() }) }));
vi.mock("@/hooks/use-test-tag-writes", () => ({
  useTestTagWrites: () => ({ recordTest: h.record, undoRecordTest: h.undoRecord, create: h.ttCreate, remove: h.ttRemove, reactivate: h.ttReactivate, retire: h.ttRetire }),
}));
vi.mock("convex/react", () => ({ useConvex: () => ({ query: h.convexQuery }) }));
vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org_1" } }),
  useSession: () => ({ data: { user: { id: "u1", name: "Sam Tester" } } }),
}));
vi.mock("@/hooks/use-member-roster", () => ({
  useMemberRoster: () => ({ nameOf: new Map(), options: [{ id: "u1", name: "Sam Tester" }, { id: "u2", name: "Kim" }] }),
}));
vi.mock("@/lib/use-permissions", () => ({
  useCurrentRole: () => ({ permissions: h.perms, isLoading: false }),
  useCanDo: (r: string, a: string) => h.perms[r]?.includes(a) ?? false,
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-stable-now", () => ({ useStableNow: () => Date.UTC(2026, 10, 22) }));
vi.mock("@/lib/scan-feedback", () => ({ playScanFeedback: vi.fn(), playScanHaptic: vi.fn() }));
vi.mock("@/components/layout/page-meta", () => ({ PageMeta: () => null }));
vi.mock("@/components/scanner/camera-scanner-dialog", () => ({ CameraScannerDialog: () => null }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: (title: string, opts?: { action?: { label: string; onClick: () => void } }) => h.toasts.push({ title, action: opts?.action }),
    error: (title: string) => h.toasts.push({ title }),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

import { ScanPage } from "@/components/scan/scan-page";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const PROFILE = {
  id: "prof1", name: "Class I appliance", equipmentClass: "CLASS_I", applianceType: "APPLIANCE",
  visualChecks: [{ key: "cordCondition", label: "Cord", enabled: true }, { key: "plugCondition", label: "Plug", enabled: true }],
  electricalTests: [
    { key: "earthContinuity", label: "Earth Continuity", threshold: 1, operator: "lt", unit: "Ω", enabled: true },
    { key: "insulationResistance", label: "Insulation Resistance", threshold: 1, operator: "gte", unit: "MΩ", enabled: true },
  ],
  thresholds: {}, requiresSubTests: false, defaultSubTestCount: 1, subTestLabel: "Outlet",
};
const tt = (patch: Record<string, unknown> = {}) => ({
  id: "tt1", testTagId: "TT-0412", description: "Aura Wash", status: "CURRENT", equipmentClass: "CLASS_I", applianceType: "APPLIANCE",
  make: null, modelName: null, lastTestDate: null, nextDueDate: null, testIntervalMonths: 3, outletCount: null, isActive: true,
  assetId: "a1", bulkAssetId: null, ...patch,
});
const card = (tag: string, patch: Record<string, unknown> = {}) => ({
  kind: "asset", tag,
  asset: { id: "a1", assetTag: "AURA-01", serialNumber: null, modelId: "m1", modelName: "Aura Wash", status: "AVAILABLE", condition: "GOOD" },
  kit: null, bulk: null, location: null, job: null, lastCheck: null, checkItemCount: 0, tt: tt(), profile: PROFILE, ...patch,
});

const saveButton = () => screen.getByRole("button", { name: "Save and scan next" });

async function answerPassing() {
  const visual = screen.getByRole("region", { name: /Visual inspection/ });
  await userEvent.click(within(visual).getByRole("button", { name: "Pass all" }));
  await userEvent.type(screen.getByRole("spinbutton", { name: "Earth Continuity" }), "0.2");
  await userEvent.click(screen.getByRole("button", { name: "Insulation Resistance: N/A" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.nav.search = "";
  h.toasts.length = 0;
  h.testCards = {
    "TT-0412": card("TT-0412"),
    "AURA-02": card("AURA-02", { tt: null, profile: null }),
    "TT-OLD": card("TT-OLD", { tt: tt({ status: "RETIRED", isActive: false, testTagId: "TT-OLD" }) }),
  };
  h.perms = { testTag: ["read", "create"], asset: ["read", "create"] };
});

describe("ScanPage — Test & tag mode", () => {
  it("one scroll, no steps: blank readings block (D51), N/A unblocks, next due is derived (D52)", async () => {
    setUrl("/scan?mode=tt&tag=TT-0412");
    render(<ScanPage />);
    expect(screen.getByText("Aura Wash", { selector: "a" })).toBeTruthy();
    expect(screen.getByText(/tested against Class I appliance/)).toBeTruthy();
    expect(screen.getByText("Finish the visual inspection (2 left)")).toBeTruthy();
    expect(saveButton()).toHaveProperty("disabled", true);
    const visual = screen.getByRole("region", { name: /Visual inspection/ });
    await userEvent.click(within(visual).getByRole("button", { name: "Pass all" }));
    expect(screen.getByText("Enter earth continuity, or mark it N/A")).toBeTruthy();
    await userEvent.type(screen.getByRole("spinbutton", { name: "Earth Continuity" }), "0.2");
    expect(screen.getByText("Enter insulation resistance, or mark it N/A")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Insulation Resistance: N/A" }));
    expect(saveButton()).toHaveProperty("disabled", false);
    expect(screen.getByText(/^Next due .* · every 3 months$/)).toBeTruthy();
    expect(screen.queryByLabelText(/next due/i, { selector: "input" })).toBeNull(); // never typed
  });

  it("save AWAITS recordTest with per-reading verdicts; ONE undo closure for toast and row", async () => {
    setUrl("/scan?mode=tt&tag=TT-0412");
    let resolve!: (v: unknown) => void;
    h.record.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    h.undoRecord.mockResolvedValue({ ok: true });
    render(<ScanPage />);
    await answerPassing();
    await userEvent.click(saveButton());
    const sent = h.record.mock.calls[0][0];
    expect(sent).toMatchObject({
      testTagAssetId: "tt1", testProfileId: "prof1", testedById: "u1", testerName: "Sam Tester",
      earthContinuityResult: "PASS", earthContinuityReading: 0.2, insulationResult: "NOT_APPLICABLE",
      visualCordCondition: true, visualPlugCondition: true, failureAction: "NONE",
    });
    expect(sent).not.toHaveProperty("nextDueDate");
    expect(sent).not.toHaveProperty("result");
    expect(replace).not.toHaveBeenCalled(); // still loaded while pending
    await act(async () => resolve({ id: "rec1", nextDueDate: Date.UTC(2027, 1, 22), result: "PASS" }));
    expect(replace).toHaveBeenLastCalledWith("/scan?mode=tt", { scroll: false });
    const toast = h.toasts.find((t) => t.title === "Pass saved for TT-0412");
    const rows = screen.getByRole("list", { name: "Recent scans" });
    await userEvent.click(within(rows).getByRole("button", { name: "Undo" }));
    await act(async () => toast!.action!.onClick());
    expect(h.undoRecord).toHaveBeenCalledTimes(1);
    expect(h.undoRecord).toHaveBeenCalledWith("rec1");
  });

  it("a fail defaults to Removed from service (D53), and the failure action word opens", async () => {
    setUrl("/scan?mode=tt&tag=TT-0412");
    h.record.mockResolvedValueOnce({ id: "rec2", nextDueDate: 0, result: "FAIL" });
    render(<ScanPage />);
    await answerPassing();
    await userEvent.click(screen.getByRole("button", { name: "Plug: failed" }));
    expect(screen.getByText(/Next due after repair/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Failure action: Removed from service/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Referred to electrician" }));
    await userEvent.click(saveButton());
    expect(h.record.mock.calls[0][0]).toMatchObject({ visualInspectionResult: "FAIL", visualPlugCondition: false, failureAction: "REFERRED_TO_ELECTRICIAN" });
  });

  it("Tested by ▾ and Method ▾ open and set the session's tester and the method", async () => {
    setUrl("/scan?mode=tt&tag=TT-0412");
    h.record.mockResolvedValueOnce({ id: "rec3", nextDueDate: 0, result: "PASS" });
    render(<ScanPage />);
    await userEvent.click(screen.getByRole("button", { name: /Tested by: Sam Tester/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Kim" }));
    await userEvent.click(screen.getByRole("button", { name: /Method: Insulation resistance/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Both" }));
    await answerPassing();
    await userEvent.click(saveButton());
    expect(h.record.mock.calls[0][0]).toMatchObject({ testedById: "u2", testerName: "Kim", testMethod: "BOTH" });
  });

  it("not on the register: Add to the register, with Undo", async () => {
    setUrl("/scan?mode=tt&tag=AURA-02");
    h.ttCreate.mockResolvedValue({ id: "ttNew", testTagId: "TT-0099" });
    render(<ScanPage />);
    expect(screen.getByText(/is not on the test & tag register/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Add to the register" }));
    expect(h.ttCreate).toHaveBeenCalledWith({ description: "Aura Wash", assetId: "a1" });
    const toast = h.toasts.find((t) => t.title.includes("added to the test & tag register as TT-0099"));
    await act(async () => toast!.action!.onClick());
    expect(h.ttRemove).toHaveBeenCalledWith("ttNew");
  });

  it("retired: Reactivate and test, with Undo (retire again)", async () => {
    setUrl("/scan?mode=tt&tag=TT-OLD");
    render(<ScanPage />);
    await userEvent.click(screen.getByRole("button", { name: "Reactivate and test" }));
    expect(h.ttReactivate).toHaveBeenCalledWith("tt1");
    const toast = h.toasts.find((t) => t.title === "TT-OLD reactivated: test it now");
    await act(async () => toast!.action!.onClick());
    expect(h.ttRetire).toHaveBeenCalledWith("tt1");
  });

  it("card ⋯ opens; Retire confirms first; Quick pass prefills the last test for review", async () => {
    setUrl("/scan?mode=tt&tag=TT-0412");
    h.convexQuery.mockResolvedValue({ visualCordCondition: true, visualPlugCondition: true, earthContinuityResult: "PASS", earthContinuityReading: 0.3, insulationResult: "NOT_APPLICABLE" });
    render(<ScanPage />);
    await userEvent.click(screen.getByRole("button", { name: "Scan actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Quick pass: repeat the last test" }));
    expect(await screen.findByDisplayValue("0.3")).toBeTruthy();
    expect(saveButton()).toHaveProperty("disabled", false);
    await userEvent.click(screen.getByRole("button", { name: "Scan actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Retire from test & tag…" }));
    const dialog = await screen.findByRole("dialog", { name: "Retire TT-0412?" });
    expect(h.ttRetire).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Retire" }));
    expect(h.ttRetire).toHaveBeenCalledWith("tt1");
  });

  it("Save and print label prints the saved record's label, not the page", async () => {
    setUrl("/scan?mode=tt&tag=TT-0412");
    h.record.mockResolvedValueOnce({ id: "rec4", nextDueDate: Date.UTC(2027, 1, 22), result: "PASS" });
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<ScanPage />);
    await answerPassing();
    await userEvent.click(screen.getByRole("button", { name: "More ways to save" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Save and print label" }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it("an outlets profile: count − + and each outlet's reading blocks", async () => {
    h.testCards["TT-BOARD"] = card("TT-BOARD", {
      profile: { ...PROFILE, visualChecks: [], requiresSubTests: true, defaultSubTestCount: 2, thresholds: { earthMax: 1 }, electricalTests: [PROFILE.electricalTests[0]] },
    });
    setUrl("/scan?mode=tt&tag=TT-BOARD");
    render(<ScanPage />);
    await userEvent.type(screen.getByRole("spinbutton", { name: "Earth Continuity" }), "0.2");
    expect(screen.getByText("Outlet 1: enter earth continuity, or mark it N/A")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "One outlet fewer" }));
    await userEvent.type(screen.getByRole("spinbutton", { name: "Outlet 1 earth continuity" }), "0.1");
    expect(saveButton()).toHaveProperty("disabled", false);
  });
});
