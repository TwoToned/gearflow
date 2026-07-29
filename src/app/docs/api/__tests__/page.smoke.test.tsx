// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ApiDocsPage from "../page";

/**
 * Smoke test for the Phase 8 (#1004) API docs page: it renders without
 * throwing, and reflects the live registry rather than static/stale text —
 * a regression here means the page stopped being a derivation of
 * API_REGISTRY/CURATED_TOOL_DEFS and started drifting.
 */
describe("ApiDocsPage", () => {
  it("renders the getting-started steps and at least one curated operation", () => {
    render(<ApiDocsPage />);

    expect(screen.getByText("RVLT Flow Agent API")).toBeTruthy();
    expect(screen.getByText("1. Mint a key")).toBeTruthy();
    expect(screen.getByText("2. Connect over MCP")).toBeTruthy();
    expect(screen.getByText(/Curated operations \(\d+\)/)).toBeTruthy();
    // whoami is always a curated tool (mcp/curated-tool-defs.ts) but has a
    // null `operation`, so it doesn't render as a registry row here — assert
    // a real curated operation instead.
    expect(screen.getByText("assets.list")).toBeTruthy();
  });

  it("lists every api.* webhook event added in Phase 8", () => {
    render(<ApiDocsPage />);
    expect(screen.getByText("api_key.created")).toBeTruthy();
    expect(screen.getByText("api_key.revoked")).toBeTruthy();
    expect(screen.getByText("api.rate_limited")).toBeTruthy();
    expect(screen.getByText("api.kill_switch_toggled")).toBeTruthy();
  });
});
