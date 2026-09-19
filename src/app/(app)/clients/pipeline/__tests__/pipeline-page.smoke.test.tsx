// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * #1245 regression — the pipeline page was stuck on "Loading…" forever.
 *
 * The Convex subscription is keyed by `(function, args)`, so the page's
 * `{ orgId, now: Date.now() }` re-keyed and re-subscribed on EVERY render: the
 * result went back to `undefined` each time data arrived, and the loading branch
 * never exited. The fix is `useStableNow()`; this pins BOTH halves — the `now`
 * argument is identical across re-renders, and the page actually renders its
 * rows once data lands.
 */

const useAuthedQuery = vi.fn();
vi.mock("@/hooks/use-authed-query", () => ({ useAuthedQuery: (...a: unknown[]) => useAuthedQuery(...a) }));
vi.mock("@/lib/auth-client", () => ({ useActiveOrganization: () => ({ data: { id: "org1" } }) }));
// The permission gate and page chrome are covered by their own tests; here they'd
// only pull a provider tree in.
vi.mock("@/components/auth/require-permission", () => ({
  RequirePermission: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/layout/page-meta", () => ({ PageMeta: () => null }));
vi.mock("../../../../../../convex/_generated/api", () => ({ api: { pipeline: { forOrg: "pipeline.forOrg" } } }));

import ClientPipelinePage from "../page";

const CARD = {
  projectId: "p1",
  projectNumber: "0001",
  projectName: "Riverside Festival",
  status: "QUOTED",
  clientId: "c1",
  clientName: "Riverside Events",
  nextStepDate: Date.UTC(2026, 8, 25),
  nextStepTitle: "Chase the quote",
  daysSinceTouch: 3,
  rotting: "none" as const,
};

beforeEach(() => useAuthedQuery.mockReset());

/** Every `now` this render pass sent to the query. */
function nowArgs(): number[] {
  return useAuthedQuery.mock.calls
    .map(([, args]) => args as { now?: number } | string)
    .filter((a): a is { now: number } => typeof a === "object" && typeof a.now === "number")
    .map((a) => a.now);
}

describe("ClientPipelinePage", () => {
  it("sends one stable `now` across re-renders (the infinite-loading bug)", () => {
    useAuthedQuery.mockReturnValue(undefined);
    const { rerender } = render(<ClientPipelinePage />);
    expect(screen.getByText("Loading…")).toBeTruthy();

    // Data arriving is itself a re-render; so is anything else on the page. Neither
    // may change the query key, or the subscription restarts and we're back to
    // `undefined` — forever.
    useAuthedQuery.mockReturnValue([CARD]);
    rerender(<ClientPipelinePage />);
    rerender(<ClientPipelinePage />);

    const sent = nowArgs();
    expect(sent.length).toBeGreaterThan(1);
    expect(new Set(sent).size).toBe(1);
  });

  it("renders the deal's row once data lands", () => {
    useAuthedQuery.mockReturnValue([CARD]);
    render(<ClientPipelinePage />);

    expect(screen.getByText("Riverside Festival")).toBeTruthy();
    expect(screen.getByText(/Riverside Events/)).toBeTruthy();
    expect(screen.getByText(/3d since touch/)).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("shows the empty state, not a spinner, when the pipeline is empty", () => {
    useAuthedQuery.mockReturnValue([]);
    render(<ClientPipelinePage />);

    expect(screen.getByText("Nothing in the pipeline")).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
  });
});
