// @vitest-environment jsdom
//
// UX Phase 7: `CommentThreadPanel`'s controlled mode (`open` / `onOpenChange` /
// `noTrigger`), which the job header and the Overview's discussion links share.
// This renders the REAL panel and its real Radix Sheet; only the data reads and
// writes are stubbed.
import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const listArgs: unknown[] = [];
vi.mock("@/hooks/use-authed-query", () => ({
  useAuthedQuery: (_ref: unknown, args: unknown) => {
    listArgs.push(args);
    return args === "skip" ? undefined : [];
  },
}));
vi.mock("@/hooks/use-server-query", () => ({ useServerQuery: () => ({ data: [] }) }));
vi.mock("@/hooks/use-server-mutation", () => ({ useServerMutation: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock("@/hooks/use-collaboration-writes", () => ({ useCollaborationWrites: () => ({ createThread: vi.fn() }) }));
vi.mock("@/server/org-members", () => ({ getMentionableMembers: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CommentThreadPanel } from "@/components/collaboration/comment-thread-panel";

/** The page's shape: state owned outside, a separate control that opens it. */
function Host({ onOpenChange }: { onOpenChange: (o: boolean) => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open the discussion
      </button>
      <CommentThreadPanel
        orgId="org1"
        entityType="project"
        entityId="p1"
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          onOpenChange(o);
        }}
        noTrigger
      />
    </>
  );
}

beforeEach(() => {
  cleanup();
  listArgs.length = 0;
});

describe("CommentThreadPanel — controlled, no trigger", () => {
  it("renders no trigger of its own and reads nothing while closed", () => {
    render(<Host onOpenChange={vi.fn()} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Open the discussion"]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(listArgs.every((a) => a === "skip")).toBe(true);
  });

  it("an outside control opens the real Sheet; Escape closes it through onOpenChange", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Host onOpenChange={onOpenChange} />);

    await user.click(screen.getByRole("button", { name: "Open the discussion" }));
    const sheet = await screen.findByRole("dialog");
    expect(sheet.textContent).toContain("Comments");
    expect(sheet.textContent).toContain("No comments yet. Start a discussion below.");
    // Project panels offer the Blocking switch.
    expect(screen.getByRole("switch")).toBeTruthy();
    expect(listArgs.some((a) => a !== "skip")).toBe(true);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
