// @vitest-environment jsdom
//
// UX Phase 10 Slice E: the link / unlink writes toast once and hand the toast an EXACT
// Undo that sends ids only (no restore value from the client).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { getFunctionName } from "convex/server";

const calls: { name: string; args: Record<string, unknown> }[] = [];
let linkResult = { created: true };
vi.mock("convex/react", () => ({
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) => async (args: Record<string, unknown>) => {
    const name = getFunctionName(ref);
    calls.push({ name, args });
    return name.endsWith("linkNative") && !name.includes("unlink") && !name.includes("undo") ? linkResult : { ok: true };
  },
}));
vi.mock("@/hooks/use-authed-query", () => ({ useAuthedQuery: () => undefined }));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "u1", name: "Alice" } } }),
  useActiveOrganization: () => ({ data: { id: "org1" } }),
}));
const toasts: { title: string; opts?: { action?: { onClick: () => void } } }[] = [];
vi.mock("sonner", () => ({
  toast: { success: (title: string, opts?: { action?: { onClick: () => void } }) => toasts.push({ title, opts }), error: vi.fn() },
}));

import { useTaskLinkActions } from "@/hooks/use-task-links";

beforeEach(() => {
  calls.length = 0;
  toasts.length = 0;
  linkResult = { created: true };
});

describe("useTaskLinkActions", () => {
  it("link: one write, one toast, and its Undo sends the link id + audit id only", async () => {
    const { result } = renderHook(() => useTaskLinkActions());
    await result.current.link({ id: "t1", title: "Book truck" }, { kind: "file", id: "pm1", label: "rider.pdf" });
    const fwd = calls[0];
    expect(fwd.name).toBe("projectTaskLinksWrites:linkNative");
    expect(fwd.args).toMatchObject({ orgId: "org1", taskId: "t1", linkedKind: "file", linkedId: "pm1" });
    expect(toasts).toHaveLength(1);
    expect(toasts[0].title).toBe("Linked “Book truck” to “rider.pdf”");
    toasts[0].opts!.action!.onClick();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].name).toBe("projectTaskLinksWrites:undoLinkNative");
    expect(Object.keys(calls[1].args).sort()).toEqual(["actor", "auditId", "id", "now", "orgId"]);
    expect(calls[1].args.id).toBe(fwd.args.id);
    expect(calls[1].args.auditId).toBe(fwd.args.auditId);
  });

  it("an existing pair toasts a plain note with NO Undo", async () => {
    linkResult = { created: false };
    const { result } = renderHook(() => useTaskLinkActions());
    await result.current.link({ id: "t1", title: "Book truck" }, { kind: "lineItem", id: "li1", label: "Transport" });
    expect(toasts[0].title).toMatch(/already linked/);
    expect(toasts[0].opts?.action).toBeUndefined();
  });

  it("unlink: its Undo re-creates from the audit row by ids only", async () => {
    const { result } = renderHook(() => useTaskLinkActions());
    await result.current.unlink({ id: "l1", taskId: "t1", taskTitle: "Book truck", kind: "file", linkedId: "pm1", label: "rider.pdf" }, "Book truck");
    expect(calls[0].name).toBe("projectTaskLinksWrites:unlinkNative");
    toasts[0].opts!.action!.onClick();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].name).toBe("projectTaskLinksWrites:undoUnlinkNative");
    expect(Object.keys(calls[1].args).sort()).toEqual(["actor", "auditId", "id", "now", "orgId"]);
    expect(calls[1].args).toMatchObject({ id: "l1", auditId: calls[0].args.auditId });
  });
});
