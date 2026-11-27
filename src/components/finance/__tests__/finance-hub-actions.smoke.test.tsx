// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FinanceHub } from "@/components/finance/finance-hub";
import { useHubActions } from "@/components/finance/use-hub-actions";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const state = vi.hoisted(() => ({
  search: "tab=invoices",
  caps: {} as Record<string, boolean>,
  xero: { isConnected: true } as { isConnected: boolean } | undefined,
  push: vi.fn(),
  data: {} as Record<string, unknown>,
  voidInv: vi.fn(async () => {}),
  deleteDraft: vi.fn(async () => {}),
  record: vi.fn(async () => ({ id: "p", autoStatus: null })),
  ack: vi.fn(async () => ({ id: "q", version: 1 })),
  generateInvoice: vi.fn(async () => ({ pdfFileId: "f", generated: true })),
  generateQuote: vi.fn(async () => ({ pdfFileId: "f", generated: true })),
  pushXero: vi.fn(async () => ({ ok: true })),
  sendEmail: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastLoading: vi.fn(),
  toastDismiss: vi.fn(),
  csv: vi.fn(),
  clip: vi.fn(async () => {}),
  open: vi.fn(),
}));

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push, replace: vi.fn() }),
  usePathname: () => "/finance",
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => state.toastSuccess(...a), error: (...a: unknown[]) => state.toastError(...a), loading: (...a: unknown[]) => state.toastLoading(...a), dismiss: (...a: unknown[]) => state.toastDismiss(...a) } }));
vi.mock("@/lib/finance-bulk", async (orig) => ({ ...(await orig<typeof import("@/lib/finance-bulk")>()), XERO_PUSH_SPACING_MS: 40 }));
vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { id: "org_1" } }), useSession: () => ({ data: { user: { id: "u", name: "U" } } }) }));
vi.mock("@/lib/use-permissions", () => ({ useCanDo: (_r: string, a: string) => state.caps[a] === true }));
vi.mock("@/hooks/use-stable-now", () => ({ useStableNow: () => Date.UTC(2026, 10, 24, 12) }));
vi.mock("@/hooks/use-xero-linked", () => ({ useXeroIntegration: () => state.xero }));
vi.mock("@/hooks/use-quote-writes", () => ({ useQuoteWrites: () => ({ acknowledgeExpired: state.ack, markAccepted: vi.fn() }) }));
vi.mock("@/hooks/use-invoice-writes", () => ({ useInvoiceWrites: () => ({ void: state.voidInv, deleteDraft: state.deleteDraft }) }));
vi.mock("@/hooks/use-payment-writes", () => ({ usePaymentWrites: () => ({ record: state.record }) }));
vi.mock("@/server/finance-documents", () => ({ generateQuoteArtifact: state.generateQuote, generateInvoiceArtifact: state.generateInvoice }));
vi.mock("@/server/xero", () => ({ pushInvoiceToXero: state.pushXero }));
vi.mock("@/lib/email", () => ({ sendEmail: state.sendEmail }));
vi.mock("@/lib/download-csv", () => ({ downloadCsv: (...a: unknown[]) => state.csv(...a) }));
vi.mock("@/hooks/use-authed-query", () => ({
  useAuthedQuery: (ref: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    return state.data[String((ref as { [k: symbol]: unknown })[Symbol.for("functionName")] ?? "")];
  },
}));

const project = { id: "p1", projectNumber: "#2341", name: "Hilton gala", clientId: "c1", clientName: "Hilton" };
const inv = (id: string, over: Record<string, unknown>) => ({
  id, invoiceNumber: `INV-${id}`, kind: "FULL", depositPercent: null, pill: "ISSUED", pillLabel: "Issued", issuedAt: Date.UTC(2026, 10, 1), dueDate: Date.UTC(2026, 10, 20),
  overdueDays: null, hasPdf: true, xero: { status: "NOT_SYNCED", error: null }, project, total: 3300, outstanding: 3300, ...over,
});

function setData() {
  state.data = {
    "financeHub:hubCounts": {
      quotes: { all: 0, draft: 0, sent: 0, accepted: 0, expired: 0 },
      invoices: { all: 3, draft: 1, depositdue: 0, issued: 1, paid: 0, overdue: 1 },
      truncated: false,
      approx: { quotes: false, invoices: false, depositdue: false, words: { quoted: false, awaitingPayment: false, overdue: false, invoicedThisMonth: false } },
    },
    "financeHub:invoicesPage": {
      kind: "invoices",
      items: [
        inv("1", { pill: "OVERDUE", pillLabel: "Overdue", overdueDays: 4, outstanding: 70 }),
        inv("2", {}),
        inv("3", { pill: "DRAFT", pillLabel: "Draft", invoiceNumber: null, hasPdf: false, xero: null, issuedAt: null, dueDate: null }),
      ],
      total: 3, totalPages: 1, page: 1, pageSize: 25, truncated: false, moneyVisible: true, now: 0, timezone: "UTC", clients: [],
    },
  };
}

const ALL = { publish: true, issue: true, record_payment: true, void: true, delete: true, xero_push: true, create: true };

afterEach(() => {
  cleanup();
  state.caps = {};
  state.xero = { isConnected: true };
  state.search = "tab=invoices";
  for (const f of [state.push, state.voidInv, state.deleteDraft, state.record, state.ack, state.generateInvoice, state.generateQuote, state.pushXero, state.sendEmail, state.toastSuccess, state.toastError, state.toastLoading, state.toastDismiss, state.csv, state.clip, state.open]) f.mockClear();
});

async function openMenu(user: ReturnType<typeof userEvent.setup>, label: RegExp) {
  await user.click(screen.getByRole("button", { name: label }));
}

describe("Finance hub actions: existing paths only", () => {
  it("an overdue invoice offers Open PDF, Record payment, Chase, Push to Xero and Void; the draft offers Preview and Delete draft", async () => {
    state.caps = ALL;
    setData();
    const user = userEvent.setup();
    render(<FinanceHub />);
    await openMenu(user, /INV-1 actions/i);
    for (const t of ["Open on the job", "Open PDF", "Record payment…", "Chase", "Push to Xero", "Void…"]) expect(await screen.findByText(t)).toBeTruthy();
    expect(screen.queryByText("Delete draft…")).toBeNull();
    expect(screen.queryByText("Generate PDF")).toBeNull(); // a stored copy exists: nothing to regenerate
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  });

  it("a role with no finance rights sees only Open on the job and Chase (absent, never disabled)", async () => {
    state.caps = {};
    setData();
    const user = userEvent.setup();
    render(<FinanceHub />);
    await openMenu(user, /INV-1 actions/i);
    expect(await screen.findByText("Open on the job")).toBeTruthy();
    expect(screen.getByText("Chase")).toBeTruthy();
    for (const t of ["Record payment…", "Push to Xero", "Void…", "Delete draft…"]) expect(screen.queryByText(t)).toBeNull();
    expect(screen.queryByRole("button", { name: /^new/i })).toBeNull(); // no create rights, no primary
  });

  it("Open PDF streams the STORED bytes through the existing route (never a render)", async () => {
    state.caps = ALL;
    setData();
    vi.stubGlobal("open", state.open);
    const user = userEvent.setup();
    render(<FinanceHub />);
    await openMenu(user, /INV-1 actions/i);
    fireEvent.click(await screen.findByText("Open PDF"));
    expect(state.open).toHaveBeenCalledWith("/api/finance/invoice/1/pdf", "_blank", "noopener,noreferrer");
    vi.unstubAllGlobals();
  });

  it("Preview draft is the watermarked preview route, and Generate PDF (attach-once) appears only on an issued row with no stored copy", async () => {
    state.caps = ALL;
    setData();
    (state.data["financeHub:invoicesPage"] as { items: Record<string, unknown>[] }).items[1] = inv("2", { hasPdf: false });
    vi.stubGlobal("open", state.open);
    const user = userEvent.setup();
    render(<FinanceHub />);
    await openMenu(user, /Draft invoice actions/i);
    fireEvent.click(await screen.findByText("Preview draft"));
    expect(state.open).toHaveBeenCalledWith("/api/documents/p1?type=invoice&preview=1&invoiceId=3", "_blank", "noopener,noreferrer");
    cleanup();
    vi.unstubAllGlobals();
    render(<FinanceHub />);
    await openMenu(user, /INV-2 actions/i);
    fireEvent.click(await screen.findByText("Generate PDF"));
    await waitFor(() => expect(state.generateInvoice).toHaveBeenCalledWith("2"));
  });

  it("Chase is COPY-ONLY: the dialog shows the text and Copy; no mail function is ever called", async () => {
    state.caps = ALL;
    setData();
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { value: { writeText: state.clip }, configurable: true });
    render(<FinanceHub />);
    await openMenu(user, /INV-1 actions/i);
    fireEvent.click(await screen.findByText("Chase"));
    const dialog = await screen.findByRole("dialog", { name: /follow-up text/i });
    const text = (within(dialog).getByLabelText("Follow-up text") as HTMLTextAreaElement).value;
    expect(text).toContain("Invoice — INV-1 (#2341)");
    expect(text).toContain("Overdue: 4 days");
    expect(text).toContain("Still owed: $70.00");
    expect(within(dialog).queryByRole("button", { name: /send|email/i })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(state.clip).toHaveBeenCalledWith(text));
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it("a chase text carries no money line when the server sent no money", async () => {
    state.caps = ALL;
    setData();
    const page = state.data["financeHub:invoicesPage"] as { items: Record<string, unknown>[]; moneyVisible: boolean };
    page.moneyVisible = false;
    page.items = page.items.map((i) => {
      const { total: _t, outstanding: _o, ...rest } = i;
      void _t;
      void _o;
      return rest;
    });
    const user = userEvent.setup();
    render(<FinanceHub />);
    await openMenu(user, /INV-1 actions/i);
    fireEvent.click(await screen.findByText("Chase"));
    const text = (within(await screen.findByRole("dialog")).getByLabelText("Follow-up text") as HTMLTextAreaElement).value;
    expect(text).not.toMatch(/\$/);
  });

  it("Record payment… opens the existing dialog; Void… is a confirmed danger verb that collects a reason and calls the existing void", async () => {
    state.caps = ALL;
    setData();
    const user = userEvent.setup();
    render(<FinanceHub />);
    await openMenu(user, /INV-2 actions/i);
    fireEvent.click(await screen.findByText("Record payment…"));
    expect(await screen.findByRole("dialog", { name: /record payment/i })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await openMenu(user, /INV-2 actions/i);
    fireEvent.click(await screen.findByText("Void…"));
    const dialog = await screen.findByRole("dialog", { name: /void INV-2/i });
    expect(within(dialog).getByText(/number stays used/i)).toBeTruthy();
    const confirm = within(dialog).getByRole("button", { name: "Void invoice" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true); // a reason is required
    await user.type(within(dialog).getByLabelText("Reason"), "Wrong client");
    await user.click(confirm);
    await waitFor(() => expect(state.voidInv).toHaveBeenCalledWith("2", "Wrong client"));
  });

  it("Delete draft… confirms (red, last) and calls the existing deleteDraft", async () => {
    state.caps = ALL;
    setData();
    const user = userEvent.setup();
    render(<FinanceHub />);
    await openMenu(user, /Draft invoice actions/i);
    fireEvent.click(await screen.findByText("Delete draft…"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/can't be undone/i)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Delete draft" }));
    await waitFor(() => expect(state.deleteDraft).toHaveBeenCalledWith("3"));
  });

  it("Push to Xero uses the existing action and is absent when Xero is not connected", async () => {
    state.caps = ALL;
    setData();
    const user = userEvent.setup();
    const { unmount } = render(<FinanceHub />);
    await openMenu(user, /INV-2 actions/i);
    fireEvent.click(await screen.findByText("Push to Xero"));
    await waitFor(() => expect(state.pushXero).toHaveBeenCalledWith("2"));
    unmount();
    state.xero = { isConnected: false };
    render(<FinanceHub />);
    await openMenu(user, /INV-2 actions/i);
    await screen.findByText("Open on the job");
    expect(screen.queryByText("Push to Xero")).toBeNull();
  });

  it("bulk: Delete n drafts skips what isn't a draft and NAMES it; the toast has no Undo (none exists)", async () => {
    state.caps = ALL;
    setData();
    const user = userEvent.setup();
    render(<FinanceHub />);
    const boxes = screen.getAllByRole("checkbox");
    await user.click(boxes[1]); // INV-1 (overdue)
    await user.click(boxes[3]); // the draft
    await user.click(await screen.findByRole("button", { name: /delete 2 drafts/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete drafts" }));
    await waitFor(() => expect(state.deleteDraft).toHaveBeenCalledTimes(1));
    expect(state.deleteDraft).toHaveBeenCalledWith("3");
    const [title, opts] = state.toastSuccess.mock.calls.at(-1)!;
    expect(title).toBe("Deleted 1 draft · skipped INV-1: only a draft can be deleted");
    expect((opts as { action?: unknown }).action).toBeUndefined();
  });

  it("bulk Export n follows the money rule and goes through the CSV guard", async () => {
    state.caps = ALL;
    setData();
    const user = userEvent.setup();
    render(<FinanceHub />);
    await user.click(screen.getAllByRole("checkbox")[2]);
    await user.click(await screen.findByRole("button", { name: /export 1/i }));
    const [csv, name] = state.csv.mock.calls[0];
    expect(name).toBe("invoices.csv");
    expect(String(csv).split("\n")[0]).toBe("Invoice,Kind,Job,Client,Status,Issued,Due,Xero,Total,Still owed");
  });

  it("+ New opens a job picker (Invoice / Quote words) and lands on the job's Finance tab", async () => {
    state.caps = ALL;
    setData();
    state.data["projects:listPage"] = { items: [{ id: "pX", projectNumber: "#9", name: "Gala", client: { name: "Hilton" } }], total: 1 };
    const user = userEvent.setup();
    render(<FinanceHub />);
    await user.click(screen.getByRole("button", { name: /^new/i }));
    const dialog = await screen.findByRole("dialog", { name: /new invoice for a job/i });
    expect(within(dialog).getByRole("radio", { name: "Quote" })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: /#9 · Gala/ }));
    expect(state.push).toHaveBeenCalledWith("/projects/pX?tab=finance");
  });
});

describe("bulk selection spans pages (a phone's Show more keeps earlier rows ticked)", () => {
  const draft = (id: string) => inv(id, { pill: "DRAFT", pillLabel: "Draft", invoiceNumber: null, hasPdf: false, xero: null, issuedAt: null, dueDate: null });
  const base = { xeroConnected: true, now: 0, timeZone: "UTC", quotes: [] };

  it("a tick from an earlier page still resolves after the current page's rows changed, and the count matches what ran", async () => {
    state.caps = ALL;
    const { result, rerender } = renderHook((p: { invoices: ReturnType<typeof draft>[] }) => useHubActions({ ...base, invoices: p.invoices as never }), { initialProps: { invoices: [draft("a")] } });
    rerender({ invoices: [draft("b")] });
    const del = result.current.invoiceBulk(["a", "b"]).find((b) => b.key === "delete")!;
    await del.onSelect();
    await waitFor(() => expect(state.deleteDraft).toHaveBeenCalledTimes(2));
    expect(state.deleteDraft).toHaveBeenCalledWith("a");
    expect(state.deleteDraft).toHaveBeenCalledWith("b");
    // No exact reverse exists, so the toast offers no Undo (the announce helper renders one only with a performUndo).
    const opts = state.toastSuccess.mock.calls.at(-1)?.[1] as { action?: unknown };
    expect(opts.action).toBeUndefined();
  });

  it("a tick with no row data at all is named in the toast, never dropped silently", async () => {
    state.caps = ALL;
    const { result } = renderHook(() => useHubActions({ ...base, invoices: [draft("a")] as never }));
    const del = result.current.invoiceBulk(["a", "ghost"]).find((b) => b.key === "delete")!;
    await del.onSelect();
    await waitFor(() => expect(state.deleteDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(state.toastSuccess.mock.calls.flat().join(" ")).toMatch(/1 selected row.*no longer in the list/));
  });

  it("the 50-row cap counts what was ticked, not what was found", async () => {
    state.caps = ALL;
    const { result } = renderHook(() => useHubActions({ ...base, invoices: [draft("a")] as never }));
    const ids = Array.from({ length: 51 }, (_, i) => `x${i}`);
    await result.current.invoiceBulk(ids).find((b) => b.key === "delete")!.onSelect();
    expect(state.deleteDraft).not.toHaveBeenCalled();
    expect(state.toastError).toHaveBeenCalledWith(expect.stringMatching(/at most 50/));
  });

  it("the Delete-draft verb is ABSENT without invoice:delete, in the row menu and in bulk", () => {
    state.caps = { ...ALL, delete: false };
    const { result } = renderHook(() => useHubActions({ ...base, invoices: [draft("a")] as never }));
    const spec = result.current.invoiceMenu(draft("a") as never);
    expect(spec.items.map((i) => i.key)).not.toContain("delete");
    expect(result.current.invoiceBulk(["a"]).map((b) => b.key)).not.toContain("delete");
    state.caps = ALL;
    const withRights = renderHook(() => useHubActions({ ...base, invoices: [draft("a")] as never }));
    expect(withRights.result.current.invoiceMenu(draft("a") as never).items.map((i) => i.key)).toContain("delete");
  });
});

describe("bulk Xero push: paced, visible, cancellable, one batch at a time", () => {
  const issued = (id: string) => inv(id, {});
  const base = { xeroConnected: true, now: 0, timeZone: "UTC", quotes: [] };
  const xeroVerb = (ids: string[]) => {
    state.caps = ALL;
    const { result } = renderHook(() => useHubActions({ ...base, invoices: ids.map(issued) as never }));
    return result.current.invoiceBulk(ids).find((b) => b.key === "xero")!;
  };

  it("starts pushes at least the spacing apart (the spacing is wired into the run)", async () => {
    const starts: number[] = [];
    state.pushXero.mockImplementation(async () => {
      starts.push(Date.now());
      return { ok: true };
    });
    await xeroVerb(["a", "b", "c"]).onSelect();
    expect(starts).toHaveLength(3);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(35);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(35);
  });

  it("shows a progress toast that updates as it goes, then dismisses it", async () => {
    state.pushXero.mockImplementation(async () => ({ ok: true }));
    await xeroVerb(["a", "b"]).onSelect();
    expect(state.toastLoading.mock.calls.map((c) => c[0])).toEqual(["Pushing 1 of 2 to Xero…", "Pushing 2 of 2 to Xero…"]);
    expect(state.toastLoading.mock.calls[0][1]).toMatchObject({ id: "finance-xero-push", action: { label: "Cancel" } });
    expect(state.toastDismiss).toHaveBeenCalledWith("finance-xero-push");
  });

  it("refuses a second batch while one is running (no interleaving), and allows one afterwards", async () => {
    let release!: () => void;
    state.pushXero.mockImplementation(() => new Promise((r) => (release = () => r({ ok: true }))));
    const verb = xeroVerb(["a"]);
    const first = verb.onSelect();
    await waitFor(() => expect(state.pushXero).toHaveBeenCalledTimes(1));
    await verb.onSelect();
    expect(state.toastError).toHaveBeenCalledWith(expect.stringMatching(/already running/));
    expect(state.pushXero).toHaveBeenCalledTimes(1);
    release();
    await first;
    state.pushXero.mockImplementation(async () => ({ ok: true }));
    await verb.onSelect();
    expect(state.pushXero).toHaveBeenCalledTimes(2);
  });

  it("Cancel stops starting new pushes and reports what ran", async () => {
    state.pushXero.mockImplementation(async () => {
      const cancel = (state.toastLoading.mock.calls.at(-1)?.[1] as { action: { onClick: () => void } }).action.onClick;
      cancel(); // the operator clicks Cancel during the first push
      return { ok: true };
    });
    await xeroVerb(["a", "b", "c"]).onSelect();
    expect(state.pushXero).toHaveBeenCalledTimes(1);
    expect(state.toastSuccess.mock.calls.flat().join(" ")).toMatch(/Synced 1 invoice.*cancelled, 2 not started/);
    expect(state.toastDismiss).toHaveBeenCalledWith("finance-xero-push");
  });
});

