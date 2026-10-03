// @vitest-environment jsdom
//
// D4 (#1108): useActivationMilestoneAnalytics fires activation_milestone the
// first time each milestone flips false -> true during THIS mount, and never
// for a milestone that was already done the first time state resolves (that
// would misreport a historical completion as a fresh one on every page load).
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  state: undefined as Record<string, unknown> | undefined,
  captured: [] as [string, unknown][],
}));

vi.mock("@/hooks/use-authed-query", () => ({
  useAuthedQuery: () => mocks.state,
}));
vi.mock("@/lib/analytics", () => ({
  capture: (event: string, props: unknown) => mocks.captured.push([event, props]),
  AnalyticsEvent: { ActivationMilestone: "activation_milestone" },
}));

import { useActivationMilestoneAnalytics } from "@/hooks/use-activation-milestones";

const EMPTY = {
  firstModelId: null,
  firstModelName: null,
  hasModel: false,
  hasAssetOnFirstModel: false,
  firstProjectId: null,
  firstProjectName: null,
  hasProject: false,
  hasModelLineItemOnFirstProject: false,
};

function Probe({ orgId }: { orgId: string | undefined }) {
  useActivationMilestoneAnalytics(orgId);
  return null;
}

beforeEach(() => {
  mocks.state = undefined;
  mocks.captured = [];
});

describe("useActivationMilestoneAnalytics", () => {
  it("does not fire while state is still loading", () => {
    render(<Probe orgId="org1" />);
    expect(mocks.captured).toEqual([]);
  });

  it("does not fire for a milestone already done the first time state resolves", () => {
    mocks.state = { ...EMPTY, hasModel: true };
    render(<Probe orgId="org1" />);
    expect(mocks.captured).toEqual([]);
  });

  it("fires once when a milestone flips from not-done to done", () => {
    mocks.state = { ...EMPTY };
    const { rerender } = render(<Probe orgId="org1" />);
    expect(mocks.captured).toEqual([]);

    mocks.state = { ...EMPTY, hasModel: true };
    rerender(<Probe orgId="org1" />);
    expect(mocks.captured).toEqual([["activation_milestone", { milestone: "model" }]]);
  });

  it("maps each milestone key to its snake_case event id", () => {
    mocks.state = { ...EMPTY, hasModel: true, hasAssetOnFirstModel: true, hasProject: true };
    const { rerender } = render(<Probe orgId="org1" />);
    mocks.captured = []; // clear the initial "already done" no-op captures

    mocks.state = { ...EMPTY, hasModel: true, hasAssetOnFirstModel: true, hasProject: true, hasModelLineItemOnFirstProject: true };
    rerender(<Probe orgId="org1" />);
    expect(mocks.captured).toEqual([["activation_milestone", { milestone: "line_item" }]]);
  });

  it("never re-fires for the same milestone across further re-renders", () => {
    mocks.state = { ...EMPTY };
    const { rerender } = render(<Probe orgId="org1" />);

    mocks.state = { ...EMPTY, hasModel: true };
    rerender(<Probe orgId="org1" />);
    expect(mocks.captured).toEqual([["activation_milestone", { milestone: "model" }]]);

    // Re-render with the SAME state again — no new capture.
    rerender(<Probe orgId="org1" />);
    expect(mocks.captured).toEqual([["activation_milestone", { milestone: "model" }]]);
  });
});
