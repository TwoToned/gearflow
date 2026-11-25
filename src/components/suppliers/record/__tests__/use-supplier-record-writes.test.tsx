// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { useSupplierRecordWrites } from "../use-supplier-record-writes";

/** UX Phase 13 B3: every write toasts; an Undo is the server's, ids only; a removal that deletes a file has none. */
const mocks = vi.hoisted(() => ({ mutations: new Map<string, ReturnType<typeof vi.fn>>(), announce: vi.fn(), toast: vi.fn() }));
vi.mock("convex/react", () => ({
  useMutation: (ref: { __name: string }) => {
    if (!mocks.mutations.has(ref.__name)) mocks.mutations.set(ref.__name, vi.fn());
    return mocks.mutations.get(ref.__name);
  },
}));
vi.mock("../../../../../convex/_generated/api", () => {
  const names = ["addContactNative", "updateContactNative", "removeContactNative", "undoContactRowNative", "addDocumentNative", "updateDocumentNative", "removeDocumentNative", "undoDocumentAddNative", "undoRowEditNative", "addOrderFileNative", "removeOrderFileNative", "undoOrderFileAddNative"];
  return { api: { supplierRecordWrites: Object.fromEntries(names.map((n) => [n, { __name: n }])) } };
});
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { id: "u1", name: "Alice" } } }) }));
vi.mock("@/lib/list-write-toast", () => ({ announceListWrite: mocks.announce }));
vi.mock("@/lib/show-error", () => ({ showError: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(mocks.toast, { success: mocks.toast, message: mocks.toast }) }));

const m = (n: string) => mocks.mutations.get(n)!;

beforeEach(() => {
  mocks.mutations.clear();
  mocks.announce.mockClear();
  mocks.toast.mockClear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "file1" }) }));
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const { result } = renderHook(() => useSupplierRecordWrites("org"));
  return result.current;
}

describe("useSupplierRecordWrites", () => {
  it("add contact: toasts, and its Undo sends ONLY ids and the forward audit id", async () => {
    const w = setup();
    m("addContactNative").mockResolvedValue({ id: "c" });
    m("undoContactRowNative").mockResolvedValue({ restored: true });
    expect(await w.addContact("s1", { name: "Priya" })).toBe(true);
    const sent = m("addContactNative").mock.calls[0][0];
    expect(sent).toMatchObject({ orgId: "org", supplierId: "s1", name: "Priya" });
    const toast = mocks.announce.mock.calls[0][0];
    expect(toast.title).toBe("Added Priya");
    await toast.performUndo();
    const undo = m("undoContactRowNative").mock.calls[0][0];
    expect(undo.forwardAuditId).toBe(sent.auditId);
    expect(Object.keys(undo).sort()).toEqual(["actor", "forwardAuditId", "now", "orgId", "supplierId"]);
  });

  it("an Undo that could not restore returns the server's note for the toast", async () => {
    const w = setup();
    m("removeContactNative").mockResolvedValue({ id: "c" });
    m("undoContactRowNative").mockResolvedValue({ restored: false, note: "The contact already exists." });
    await w.removeContact("s1", "c", "Priya");
    expect(await mocks.announce.mock.calls[0][0].performUndo()).toBe("The contact already exists.");
  });

  it("edit contact: no toast when nothing changed; otherwise Undo is undoRowEditNative by id", async () => {
    const w = setup();
    m("updateContactNative").mockResolvedValueOnce({ changed: false });
    await w.updateContact("s1", "c1", { name: "Priya" });
    expect(mocks.announce).not.toHaveBeenCalled();
    m("updateContactNative").mockResolvedValueOnce({ changed: true });
    m("undoRowEditNative").mockResolvedValue({ restored: ["name"] });
    await w.updateContact("s1", "c1", { name: "Priya S" });
    await mocks.announce.mock.calls[0][0].performUndo();
    expect(m("undoRowEditNative").mock.calls[0][0]).toMatchObject({ kind: "contact", rowId: "c1", orgId: "org" });
  });

  it("add document: uploads first, then attaches; the Undo detaches the row only (the file stays)", async () => {
    const w = setup();
    m("addDocumentNative").mockResolvedValue({ id: "d" });
    m("undoDocumentAddNative").mockResolvedValue({ restored: true });
    const file = new File(["x"], "cover.pdf");
    await w.addDocument("s1", file, { name: "Cover", expiryDate: 5 });
    expect(fetch).toHaveBeenCalledWith("/api/uploads", expect.objectContaining({ method: "POST" }));
    expect(m("addDocumentNative").mock.calls[0][0]).toMatchObject({ fileId: "file1", name: "Cover", expiryDate: 5 });
    expect(mocks.announce.mock.calls[0][0].undoneTitle).toMatch(/file stays in storage/);
    await mocks.announce.mock.calls[0][0].performUndo();
    expect(m("undoDocumentAddNative")).toHaveBeenCalledTimes(1);
  });

  it("a failed upload never reaches the write", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Too big" }) }));
    const w = setup();
    expect(await w.addOrderFile("o1", new File(["x"], "po.pdf"), "PO")).toBe(false);
    expect(m("addOrderFileNative")).not.toHaveBeenCalled();
    expect(mocks.announce).not.toHaveBeenCalled();
  });

  it("removing a document or an order file deletes the stored file: a plain toast, NO Undo", async () => {
    const w = setup();
    m("removeDocumentNative").mockResolvedValue({ id: "d" });
    m("removeOrderFileNative").mockResolvedValue({ id: "f" });
    await w.removeDocument("s1", "d1", "Cover");
    await w.removeOrderFile("o1", "of1", "po.pdf");
    expect(mocks.announce).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringMatching(/file is deleted/i));
    expect(mocks.toast).toHaveBeenCalledTimes(2);
  });
});
