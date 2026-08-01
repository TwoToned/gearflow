// @vitest-environment jsdom
//
// #957 lifecycle-lock UI: renders the actual overlay components (not just the
// closed trigger) per CLAUDE.md's overlay-test rule — a Radix Dialog or a
// Tooltip missing its TooltipProvider passes typecheck/lint/build and only
// crashes at render time.
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "user1", name: "Alice" } } }),
}));

const mutateMock = vi.fn(async () => ({ conflicts: [] }));
vi.mock("convex/react", () => ({
  useMutation: () => mutateMock,
  useQuery: () => undefined,
}));

import { JustificationDialog } from "@/components/projects/justification-dialog";
import { UnlockSessionDialog } from "@/components/projects/unlock-session-dialog";
import { UnlockSessionBanner } from "@/components/projects/unlock-session-banner";
import { UnpricedBadge } from "@/components/projects/unpriced-badge";

describe("JustificationDialog smoke", () => {
  it("renders open, shows the status-aware copy, and requires 10+ characters before confirming", async () => {
    const onConfirm = vi.fn();
    render(
      <JustificationDialog
        open
        onOpenChange={() => {}}
        onConfirm={onConfirm}
        onCancel={() => {}}
        status="ON_SITE"
      />,
    );
    expect(screen.getByText(/This project is ON_SITE/i)).toBeTruthy();
    const textarea = screen.getByLabelText("Justification") as HTMLTextAreaElement;
    const confirmButton = screen.getByRole("button", { name: /confirm change/i }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: "too short" } });
    expect(confirmButton.disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: "Client swapped the LED wall on site." } });
    expect(confirmButton.disabled).toBe(false);
    fireEvent.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledWith("Client swapped the LED wall on site.");
  });
});

describe("UnlockSessionDialog smoke", () => {
  it("renders FULL-scope copy and gates confirm on the justification length", () => {
    render(
      <UnlockSessionDialog open onOpenChange={() => {}} onConfirm={() => {}} scope="FULL" />,
    );
    expect(screen.getByText(/Open a full unlock session/i)).toBeTruthy();
    expect(screen.getByText(/restricted to org admins\/owners/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: /unlock/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders FINANCIAL-scope copy", () => {
    render(
      <UnlockSessionDialog open onOpenChange={() => {}} onConfirm={() => {}} scope="FINANCIAL" />,
    );
    expect(screen.getByText(/Unlock financials/i)).toBeTruthy();
  });
});

describe("UnlockSessionBanner smoke", () => {
  it("renders the open-session banner and opens the discard confirm dialog", async () => {
    render(
      <UnlockSessionBanner
        projectId="p1"
        orgId="org1"
        session={{
          scope: "FINANCIAL",
          justification: "Client requested a discount.",
          openedByName: "Bob",
          openedAt: Date.now() - 5 * 60_000,
          snapshotId: "snap1",
        }}
      />,
    );
    expect(screen.getByText(/Financials unlocked by Bob/i)).toBeTruthy();
    expect(screen.getByText(/Client requested a discount\./)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /discard changes/i }));
    await waitFor(() => expect(screen.getByText(/Discard changes made during this session\?/i)).toBeTruthy());
  });
});

describe("UnpricedBadge smoke", () => {
  it("renders with its own TooltipProvider (no global provider in this app)", async () => {
    render(<UnpricedBadge />);
    expect(screen.getByText("Unpriced")).toBeTruthy();
  });
});
