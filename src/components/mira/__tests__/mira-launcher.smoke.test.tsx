// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const askMira = vi.hoisted(() => vi.fn());
vi.mock("@/server/mira", () => ({ askMira: (...args: unknown[]) => askMira(...args) }));

import MiraContextProvider from "@/components/providers/mira-context-provider";
import { MiraLauncher } from "@/components/mira/mira-launcher";

/**
 * Smoke test for Mira's first real UI consumer (Phase 8, #1004). Regression
 * target: the panel is `next/dynamic(..., { ssr: false })`-loaded, so a
 * naive render-and-assert misses it entirely — this exercises the full
 * open → load → ask → answer round trip.
 */
describe("MiraLauncher + MiraPanel", () => {
  beforeEach(() => {
    askMira.mockReset();
    askMira.mockResolvedValue({ answer: "You have 3 assets.", operation: "assets.list" });
  });

  it("opens the panel, asks a question, and renders the answer", async () => {
    const user = userEvent.setup();
    render(
      <MiraContextProvider>
        <MiraLauncher />
      </MiraContextProvider>,
    );

    await user.click(screen.getByRole("button", { name: /ask mira/i }));

    const input = await screen.findByPlaceholderText(/ask a question/i);
    await user.type(input, "list assets");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(askMira).toHaveBeenCalledWith("list assets", null));
    expect(await screen.findByText("You have 3 assets.")).toBeTruthy();
  });

  it("closes the panel and shows the trigger again", async () => {
    const user = userEvent.setup();
    render(
      <MiraContextProvider>
        <MiraLauncher />
      </MiraContextProvider>,
    );

    await user.click(screen.getByRole("button", { name: /ask mira/i }));
    await screen.findByText("Ask Mira");

    await user.click(screen.getByRole("button", { name: /close mira/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /ask mira/i })).toBeTruthy());
  });
});
