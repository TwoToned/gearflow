// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getMiraConversation = vi.hoisted(() => vi.fn());
const sendMiraMessage = vi.hoisted(() => vi.fn());
vi.mock("@/server/mira", () => ({
  getMiraConversation: (...args: unknown[]) => getMiraConversation(...args),
  sendMiraMessage: (...args: unknown[]) => sendMiraMessage(...args),
  confirmMiraPendingAction: vi.fn(),
  dismissMiraPendingAction: vi.fn(),
  clearMiraConversation: vi.fn(),
}));

const isMiraConfigured = vi.hoisted(() => vi.fn());
vi.mock("@/server/mira-settings", () => ({ isMiraConfigured: (...args: unknown[]) => isMiraConfigured(...args) }));

import MiraContextProvider from "@/components/providers/mira-context-provider";
import { MiraLauncher } from "@/components/mira/mira-launcher";

/**
 * Smoke test for Mira's chat panel (now a real LLM tool-calling loop behind
 * `sendMiraMessage`, FEATUREDOCS/68). Regression target: the panel is
 * `next/dynamic(..., { ssr: false })`-loaded, so a naive render-and-assert
 * misses it entirely — this exercises the full open → load → ask → answer
 * round trip.
 */
describe("MiraLauncher + MiraPanel", () => {
  beforeEach(() => {
    getMiraConversation.mockReset();
    sendMiraMessage.mockReset();
    isMiraConfigured.mockReset();
    isMiraConfigured.mockResolvedValue({ configured: true });
    getMiraConversation.mockResolvedValue({ conversationId: null, messages: [] });
    sendMiraMessage.mockResolvedValue({
      conversationId: "conv_1",
      newMessages: [
        { id: "m1", role: "user", content: "list assets", createdAt: 1 },
        { id: "m2", role: "assistant", content: "You have 3 assets.", createdAt: 2 },
      ],
    });
  });

  it("renders nothing — no button, no panel — when the org has no OpenRouter key configured", async () => {
    isMiraConfigured.mockResolvedValue({ configured: false });
    render(
      <MiraContextProvider>
        <MiraLauncher />
      </MiraContextProvider>,
    );

    await waitFor(() => expect(isMiraConfigured).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /ask mira/i })).toBeNull();
  });

  it("opens the panel, asks a question, and renders the answer", async () => {
    const user = userEvent.setup();
    render(
      <MiraContextProvider>
        <MiraLauncher />
      </MiraContextProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /ask mira/i }));

    const input = await screen.findByPlaceholderText(/ask a question/i);
    await user.type(input, "list assets");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(sendMiraMessage).toHaveBeenCalledWith("list assets", null));
    expect(await screen.findByText("You have 3 assets.")).toBeTruthy();
  });

  it("closes the panel and shows the trigger again", async () => {
    const user = userEvent.setup();
    render(
      <MiraContextProvider>
        <MiraLauncher />
      </MiraContextProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /ask mira/i }));
    await screen.findByText("Ask Mira");

    await user.click(screen.getByRole("button", { name: /close mira/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /ask mira/i })).toBeTruthy());
  });
});
