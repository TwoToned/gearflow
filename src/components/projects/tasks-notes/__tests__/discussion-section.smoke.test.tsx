// @vitest-environment jsdom
//
// UX Phase 10 (spec §8c): the Discussion section on the Tasks & notes tab renders
// the REAL shared thread body inline (not a Sheet). The composer's `@ Mention ▾` is
// OPENED, the `Blocking` switch is flipped, and the post goes through the one
// `createThread` write with `isBlocking`.
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FunctionReference } from "convex/server";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const createThread = vi.fn(async () => ({ id: "t1" }));
vi.mock("@/hooks/use-collaboration-writes", () => ({
  useCollaborationWrites: () => ({ createThread, addComment: vi.fn(), resolveThread: vi.fn(), reopenThread: vi.fn(), setThreadBlocking: vi.fn() }),
}));
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (q: FunctionReference<"query">, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(q);
      if (name === "collaboration:listThreadCommentCounts") return { __entity__: { open: 1, total: 1, blockingOpen: 0 }, li1: { open: 2, total: 2, blockingOpen: 0 } };
      return []; // no threads yet
    },
  };
});
vi.mock("@/hooks/use-server-query", () => ({ useServerQuery: () => ({ data: [{ userId: "u2", name: "Bob", email: "b@x.co" }] }) }));
vi.mock("@/hooks/use-server-mutation", () => ({
  useServerMutation: (o: { mutationFn: (v: { body: string }) => Promise<unknown> }) => ({ mutate: (v: { body: string }) => void o.mutationFn(v), isPending: false }),
}));
vi.mock("@/server/org-members", () => ({ getMentionableMembers: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
let canBlock = true;
vi.mock("@/lib/use-permissions", () => ({ useCanDo: (_r: string, action: string) => (action === "manage_line_items" ? canBlock : true) }));

import { DiscussionSection } from "@/components/projects/tasks-notes/discussion-section";

beforeEach(() => {
  vi.clearAllMocks();
  canBlock = true;
});

describe("DiscussionSection", () => {
  it("renders inline (no Sheet), counts line-item threads and jumps to Equipment", async () => {
    const user = userEvent.setup();
    const onOpenEquipment = vi.fn();
    render(<DiscussionSection projectId="p1" orgId="org1" onOpenEquipment={onOpenEquipment} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("No comments yet. Start a discussion below.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /On line items · 2 open/ }));
    expect(onOpenEquipment).toHaveBeenCalledTimes(1);
  });

  it("a caller without project:manage_line_items gets NO Blocking switch (absent, not an error)", () => {
    canBlock = false;
    render(<DiscussionSection projectId="p1" orgId="org1" onOpenEquipment={vi.fn()} />);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByLabelText("New discussion")).toBeTruthy(); // a plain discussion is still open to them
  });

  it("the Blocking switch posts a blocking thread; the @ Mention picker opens", async () => {
    const user = userEvent.setup();
    render(<DiscussionSection projectId="p1" orgId="org1" onOpenEquipment={vi.fn()} />);
    await user.type(screen.getByLabelText("New discussion"), "Hold prep until the PO lands");
    await user.click(screen.getByRole("switch", { name: /Blocking/ }));
    expect(screen.getByText(/Blocks prepping & sending out until resolved/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Mention/ }));
    expect(await screen.findByRole("menuitemcheckbox", { name: /Bob/ })).toBeTruthy();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: /Post comment/ }));
    expect(createThread).toHaveBeenCalledWith("project", "p1", "Hold prep until the PO lands", undefined, undefined, expect.objectContaining({ isBlocking: true, projectId: "p1" }));
  });
});
