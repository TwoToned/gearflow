// @vitest-environment jsdom
//
// PromoteVersionDialog (#1080/#1097) — the standing jsdom-smoke rule
// (CLAUDE.md) for any new overlay: typecheck/lint/build all pass on a Dialog
// that throws at render time, only actually mounting it catches that.
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FunctionReference } from "convex/server";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

const TARGET_ENTRIES = [
  { entityType: "project", entityId: "p1", data: { rentalStartDate: 100, rentalEndDate: 200 } },
  { entityType: "lineItem", entityId: "l1", data: { description: "PA System" } },
  { entityType: "group", entityId: "g1", data: { title: "Stage" } },
];
const CURRENT_ENTRIES = [
  { entityType: "project", entityId: "p1", data: { rentalStartDate: 300, rentalEndDate: 400 } },
  { entityType: "lineItem", entityId: "l1", data: { description: "PA System" } },
  { entityType: "lineItem", entityId: "l2", data: { description: "MA3 Light", assetId: "a1" } },
];

vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (query: FunctionReference<"query">, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "projectLocksRead:snapshotEntries") return TARGET_ENTRIES;
      if (name === "projectLocksRead:currentEntries") return CURRENT_ENTRIES;
      return undefined;
    },
  };
});

const promoteRevision = vi.fn().mockResolvedValue({ conflicts: [], liveRevision: 2 });
vi.mock("@/hooks/use-project-version-writes", () => ({
  useProjectVersionWrites: () => ({ promoteRevision }),
}));

import { PromoteVersionDialog } from "@/components/projects/finance/promote-version-dialog";

describe("PromoteVersionDialog smoke", () => {
  const baseProps = {
    open: true,
    onOpenChange: vi.fn(),
    projectId: "p1",
    orgId: "org1",
    targetRevision: 2,
    targetSnapshotId: "snap2",
    liveRevision: 4,
    liveHasSnapshot: true,
    onPromoted: vi.fn(),
  };

  it("renders the diff summary, including a predicted warehouse-backed conflict", async () => {
    render(<PromoteVersionDialog {...baseProps} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: /Make v2 live\?/ })).toBeTruthy());
    expect(screen.getByText(/1 line item.*1 group.*0 services/i)).toBeTruthy();
    expect(screen.getByText(/Needs your review after/i)).toBeTruthy();
    expect(screen.getByText(/MA3 Light/)).toBeTruthy();
  });

  it("confirms and calls promoteRevision with the target revision", async () => {
    const user = userEvent.setup();
    const onPromoted = vi.fn();
    render(<PromoteVersionDialog {...baseProps} onPromoted={onPromoted} />);

    await screen.findByRole("heading", { name: /Make v2 live\?/ });
    await user.click(screen.getByRole("button", { name: /^Make v2 live$/ }));

    await waitFor(() => expect(promoteRevision).toHaveBeenCalledWith("p1", 2));
    await waitFor(() => expect(onPromoted).toHaveBeenCalledWith({ conflicts: [], liveRevision: 2 }));
  });
});
