// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ usePathname: () => "/projects/cm1abcdefghijklmnopqrstuv", useRouter: () => ({ push: vi.fn() }) }));
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
import { MiraLauncher, MiraPanelHost } from "@/components/mira/mira-launcher";

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
        <MiraPanelHost />
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
        <MiraPanelHost />
      </MiraContextProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /ask mira/i }));

    const input = await screen.findByPlaceholderText(/ask a question/i);
    await user.type(input, "list assets");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(sendMiraMessage).toHaveBeenCalledWith("list assets", null));
    expect(await screen.findByText("You have 3 assets.")).toBeTruthy();
  });

  const renderMira = () =>
    render(
      <MiraContextProvider>
        <MiraLauncher />
        <MiraPanelHost />
      </MiraContextProvider>,
    );

  it("the word toggles the panel: the Close button and the word both close it", async () => {
    const user = userEvent.setup();
    renderMira();

    const word = await screen.findByRole("button", { name: /ask mira/i });
    expect(word.getAttribute("aria-pressed")).toBe("false");
    await user.click(word);
    await screen.findByText("Looking at Jobs");
    expect(word.getAttribute("aria-pressed")).toBe("true");

    await user.click(screen.getByRole("button", { name: /close mira/i }));
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Mira" })).toBeNull());

    await user.click(word);
    await screen.findByRole("complementary", { name: "Mira" });
    await user.click(word);
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Mira" })).toBeNull());
  });

  it("is a 384 px panel under the bar (no floating button) and Esc closes it", async () => {
    const user = userEvent.setup();
    renderMira();
    await user.click(await screen.findByRole("button", { name: /ask mira/i }));
    const panel = await screen.findByRole("complementary", { name: "Mira" });
    expect(panel.className).toContain("w-96");
    expect(panel.className).toContain("top-14");
    expect(panel.className).not.toContain("shadow");
    expect(document.querySelector(".fixed.bottom-20")).toBeNull();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Mira" })).toBeNull());
  });

  it("on a phone it is a full-height sheet that Esc also closes", async () => {
    const mql = (q: string) => ({ matches: q.includes("859"), media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false });
    vi.stubGlobal("matchMedia", mql);
    const prev = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true, writable: true });
    const user = userEvent.setup();
    renderMira();
    await user.click(await screen.findByRole("button", { name: /ask mira/i }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.className).toContain("inset-0");
    expect(screen.queryByRole("complementary", { name: "Mira" })).toBeNull();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    Object.defineProperty(window, "innerWidth", { value: prev, configurable: true, writable: true });
    vi.unstubAllGlobals();
  });
});
