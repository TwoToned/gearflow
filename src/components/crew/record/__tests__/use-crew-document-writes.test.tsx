// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { useCrewDocumentWrites } from "../use-crew-document-writes";

/** UX Phase 13, D72: every write toasts, the Undo is the server's (ids only), the upload carries the crew-document purpose, a removal has no Undo. */
const mocks = vi.hoisted(() => ({ mutations: new Map<string, ReturnType<typeof vi.fn>>(), announce: vi.fn(), toast: vi.fn() }));
vi.mock("convex/react", () => ({
  useMutation: (ref: { __name: string }) => {
    if (!mocks.mutations.has(ref.__name)) mocks.mutations.set(ref.__name, vi.fn());
    return mocks.mutations.get(ref.__name);
  },
}));
vi.mock("../../../../../convex/_generated/api", () => ({
  api: { crewDocumentsWrites: Object.fromEntries(["addNative", "updateNative", "removeNative", "undoAddNative", "undoUpdateNative"].map((n) => [n, { __name: n }])) },
}));
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

const setup = () => renderHook(() => useCrewDocumentWrites("org")).result.current;

describe("useCrewDocumentWrites", () => {
  it("add: uploads with purpose crew-document, then attaches; the Undo sends only ids and the forward audit id", async () => {
    const w = setup();
    m("addNative").mockResolvedValue({ id: "d" });
    m("undoAddNative").mockResolvedValue({ restored: true });
    expect(await w.add("c1", new File(["x"], "card.pdf"), { kind: "LICENCE", name: "White card" })).toBe(true);
    const form = (fetch as unknown as { mock: { calls: [string, { body: FormData }][] } }).mock.calls[0][1].body;
    expect(form.get("purpose")).toBe("crew-document");
    expect(form.get("entityId")).toBe("c1");
    const sent = m("addNative").mock.calls[0][0];
    expect(sent).toMatchObject({ orgId: "org", crewMemberId: "c1", fileId: "file1", kind: "LICENCE" });
    await mocks.announce.mock.calls[0][0].performUndo();
    const undo = m("undoAddNative").mock.calls[0][0];
    expect(undo.forwardAuditId).toBe(sent.auditId);
    expect(Object.keys(undo).sort()).toEqual(["actor", "crewMemberId", "forwardAuditId", "now", "orgId"]);
    expect(mocks.announce.mock.calls[0][0].undoneTitle).toMatch(/file stays in storage/);
  });

  it("a failed upload never reaches the write", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Too big" }) }));
    const w = setup();
    expect(await w.add("c1", new File(["x"], "card.pdf"), { kind: "ID" })).toBe(false);
    expect(m("addNative")).not.toHaveBeenCalled();
    expect(mocks.announce).not.toHaveBeenCalled();
  });

  it("update: no toast when nothing changed; otherwise the Undo is undoUpdateNative by id", async () => {
    const w = setup();
    m("updateNative").mockResolvedValueOnce({ changed: false });
    await w.update("c1", "d1", { kind: "LICENCE" });
    expect(mocks.announce).not.toHaveBeenCalled();
    m("updateNative").mockResolvedValueOnce({ changed: true });
    m("undoUpdateNative").mockResolvedValue({ restored: ["expiresAt"] });
    await w.update("c1", "d1", { kind: "LICENCE", expiresAt: 5 });
    await mocks.announce.mock.calls[0][0].performUndo();
    expect(m("undoUpdateNative").mock.calls[0][0]).toMatchObject({ orgId: "org", documentId: "d1" });
  });

  it("remove deletes the stored file: a plain toast, NO Undo", async () => {
    const w = setup();
    m("removeNative").mockResolvedValue({ id: "d1" });
    await w.remove("c1", "d1", "White card");
    expect(mocks.announce).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringMatching(/file is deleted/i));
  });
});
