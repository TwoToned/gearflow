// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ClientMergeDialog } from "@/components/clients/client-merge-dialog";
import { HireDateDialog } from "@/components/suppliers/orders/hire-dialogs";

/** UX Phase 13: the Merge and the Mark returned / Extend hire dialogs, opened and driven. */
const mocks = vi.hoisted(() => ({
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
  preview: undefined as unknown,
  announce: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useMutation: (ref: { name?: string }) => {
    const key = String((ref as unknown as { __name?: string }).__name ?? "m");
    if (!mocks.mutations.has(key)) mocks.mutations.set(key, vi.fn());
    return mocks.mutations.get(key);
  },
}));
vi.mock("../../../../convex/_generated/api", () => {
  const leaf = (name: string) => ({ __name: name });
  return {
    api: {
      clientMergeWrites: { mergeClientsNative: leaf("merge"), undoClientMergeNative: leaf("undoMerge"), mergePreview: leaf("preview") },
      supplierOrdersWrites: { markReturnedNative: leaf("markReturned"), extendHireNative: leaf("extend"), undoHireChangeNative: leaf("undoHire") },
    },
  };
});
vi.mock("@/hooks/use-authed-query", () => ({ useAuthedQuery: () => mocks.preview }));
vi.mock("@/hooks/use-clients", () => ({
  useClients: () => [
    { id: "keep", name: "Hilton", isActive: true },
    { id: "gone", name: "Hilton Sydney", isActive: true },
    { id: "old", name: "Archived Co", isActive: false },
  ],
}));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "u1", name: "Alice" } } }) }));
vi.mock("@/lib/list-write-toast", async (orig) => ({ ...(await orig<object>()), announceListWrite: mocks.announce }));

beforeEach(() => {
  mocks.mutations.clear();
  mocks.announce.mockClear();
  mocks.preview = undefined;
});
afterEach(cleanup);

describe("ClientMergeDialog", () => {
  it("offers only OTHER ACTIVE clients, shows what moves, and Merge calls the write then toasts with Undo", async () => {
    mocks.preview = {
      survivor: { id: "keep", name: "Hilton" }, loser: { id: "gone", name: "Hilton Sydney" },
      counts: { projects: 2, versions: 3, invoices: 1, contacts: 1, media: 0, links: 0, skippedMedia: 1 },
      jobs: [{ id: "p1", projectNumber: "#2341", name: "Gala" }], invoices: [], contacts: [],
    };
    render(<ClientMergeDialog open onOpenChange={vi.fn()} orgId="org" loser={{ id: "gone", name: "Hilton Sydney" }} />);
    expect(screen.queryByText("Archived Co")).toBeNull();
    expect(screen.queryByRole("button", { name: "Hilton Sydney" })).toBeNull();
    const merge = screen.getByRole("button", { name: "Merge" });
    expect((merge as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Hilton" }));
    expect(screen.getByText(/Moves 2 jobs, 1 invoice, 1 contact/)).toBeTruthy();
    expect(screen.getByText(/#2341/)).toBeTruthy();
    expect(screen.getByText(/Not moved/)).toBeTruthy();
    mocks.mutations.get("merge")?.mockResolvedValue?.({ counts: { projects: 2, invoices: 1, contacts: 1 } });
    const mergeFn = mocks.mutations.get("merge")!;
    mergeFn.mockResolvedValue({ counts: { projects: 2, versions: 3, invoices: 1, contacts: 1, media: 0, links: 0, skippedMedia: 1 }, auditId: "a" });
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    await waitFor(() => expect(mocks.announce).toHaveBeenCalled());
    expect(mergeFn.mock.calls[0][0]).toMatchObject({ orgId: "org", survivorId: "keep", loserId: "gone" });
    const toast = mocks.announce.mock.calls[0][0];
    expect(toast.title).toMatch(/Merged Hilton Sydney into Hilton/);
    expect(typeof toast.performUndo).toBe("function");
  });
});

describe("HireDateDialog", () => {
  const order = { id: "o1", orderNumber: "SH-12", returnDueDate: Date.UTC(2026, 10, 7) };
  it("Mark returned: opens, sends returnedDate, and the toast's Undo is the server's (forward audit id only)", async () => {
    mocks.mutations.set("markReturned", vi.fn().mockResolvedValue({ id: "o1" }));
    mocks.mutations.set("undoHire", vi.fn().mockResolvedValue({ restored: ["returnedDate"] }));
    render(<HireDateDialog mode="return" onOpenChange={vi.fn()} orgId="org" order={order} />);
    expect(screen.getByText("Mark SH-12 returned")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Returned on"), { target: { value: "2026-11-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Mark returned" }));
    await waitFor(() => expect(mocks.announce).toHaveBeenCalled());
    const sent = mocks.mutations.get("markReturned")!.mock.calls[0][0];
    expect(sent).toMatchObject({ id: "o1", orgId: "org", returnedDate: Date.UTC(2026, 10, 20) });
    await mocks.announce.mock.calls[0][0].performUndo();
    const undoArgs = mocks.mutations.get("undoHire")!.mock.calls[0][0];
    expect(undoArgs.forwardAuditId).toBe(sent.auditId);
    expect(Object.keys(undoArgs).sort()).toEqual(["actor", "forwardAuditId", "id", "now", "orgId"]); // no client-supplied restore value
  });

  it("Extend hire: defaults to the day after the current due date and sends returnDueDate", async () => {
    mocks.mutations.set("extend", vi.fn().mockResolvedValue({ id: "o1" }));
    render(<HireDateDialog mode="extend" onOpenChange={vi.fn()} orgId="org" order={order} />);
    expect((screen.getByLabelText("Return due") as HTMLInputElement).value).toBe("2026-11-08");
    expect(screen.getByText(/job's own hire window is not changed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Extend hire" }));
    await waitFor(() => expect(mocks.announce).toHaveBeenCalled());
    expect(mocks.mutations.get("extend")!.mock.calls[0][0]).toMatchObject({ returnDueDate: Date.UTC(2026, 10, 8) });
  });

  it("renders nothing while closed", () => {
    render(<HireDateDialog mode={null} onOpenChange={vi.fn()} orgId="org" order={order} />);
    expect(screen.queryByText(/Mark SH-12 returned/)).toBeNull();
  });
});
