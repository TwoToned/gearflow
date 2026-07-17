// @vitest-environment jsdom
//
// Regression guard for the Finding #1 fix, "Option A" (docs/designs/
// perf-convex-efficiency-2026-06.md): ProjectBoard used to mount 2 whole-org
// live subscriptions (useProjects/useClients) and filter/join client-side.
// It now calls projects.listBoard (server-side filter + client join) via
// useAuthedQuery. This test pins that the board renders cards grouped by
// lifecycle stage off a listBoard-shaped result.
import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { FunctionReference } from "convex/server";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});

vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: { id: "org1" } }),
}));
vi.mock("@/components/auth/permission-gate", () => ({
  CanDo: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/server/projects", () => ({
  getProjectIssueFlags: vi.fn(async () => ({})),
}));
vi.mock("@/hooks/use-server-query", () => ({
  useServerQuery: () => ({ data: {} }),
}));

const BOARD_ROWS = [
  {
    id: "p1",
    projectNumber: "P-001",
    name: "Splendour Main Stage",
    status: "CONFIRMED",
    client: { name: "Acme Corp" },
  },
];

let lastBoardArgs: unknown;
vi.mock("@/hooks/use-authed-query", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAuthedQuery: (query: FunctionReference<"query">, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query);
      if (name === "projects:listBoard") {
        lastBoardArgs = args;
        return BOARD_ROWS;
      }
      return undefined;
    },
  };
});

import { ProjectBoard } from "../project-board";

describe("ProjectBoard (smoke)", () => {
  it("renders a card for each project from projects.listBoard, in its lifecycle column", () => {
    render(<ProjectBoard />);
    expect(screen.getByText("Splendour Main Stage")).toBeTruthy();
    // Client name renders inline as "P-001 · Acme Corp" (JSX fragment), not
    // as its own isolated text node — match the substring.
    expect(screen.getByText(/Acme Corp/)).toBeTruthy();
    // CONFIRMED status lands in the "Confirmed" column.
    expect(screen.getByText("Confirmed")).toBeTruthy();
  });

  it("passes the current org id (no client-side whole-org read)", () => {
    render(<ProjectBoard />);
    expect(lastBoardArgs).toMatchObject({ orgId: "org1" });
  });

  it("debounces the search box instead of firing a query per keystroke", () => {
    render(<ProjectBoard />);
    const input = screen.getByPlaceholderText("Search jobs by name, # or client…");
    fireEvent.change(input, { target: { value: "splendour" } });
    expect((lastBoardArgs as { search?: string })?.search).toBeUndefined();
  });
});
