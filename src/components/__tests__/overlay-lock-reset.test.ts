// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { healOrphanedLocks } from "@/components/overlay-lock-reset";

beforeEach(() => {
  document.body.innerHTML = "";
  document.body.style.pointerEvents = "";
  document.documentElement.style.pointerEvents = "";
});

describe("healOrphanedLocks", () => {
  it("removes an orphaned full-screen backdrop and un-inerts marked content", () => {
    const backdrop = document.createElement("div");
    backdrop.setAttribute("role", "presentation");
    backdrop.setAttribute("data-base-ui-inert", "");
    document.body.appendChild(backdrop);

    const content = document.createElement("main");
    content.setAttribute("data-base-ui-inert", "");
    content.setAttribute("inert", "");
    content.setAttribute("aria-hidden", "true");
    content.style.pointerEvents = "none";
    const btn = document.createElement("button");
    content.appendChild(btn);
    document.body.appendChild(content);

    const healed = healOrphanedLocks(document);

    expect(healed).toBe(true);
    expect(document.querySelector('[role="presentation"]')).toBeNull(); // backdrop gone
    expect(content.hasAttribute("inert")).toBe(false);
    expect(content.hasAttribute("aria-hidden")).toBe(false);
    expect(content.hasAttribute("data-base-ui-inert")).toBe(false);
    expect(content.style.pointerEvents).toBe("");
  });

  it("clears a stuck body/html pointer-events lock", () => {
    document.body.style.pointerEvents = "none";
    document.documentElement.style.pointerEvents = "none";
    expect(healOrphanedLocks(document)).toBe(true);
    expect(document.body.style.pointerEvents).toBe("");
    expect(document.documentElement.style.pointerEvents).toBe("");
  });

  it("does NOTHING while a real overlay is open (guard)", () => {
    // A genuinely open menu legitimately marks the rest of the page inert.
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.appendChild(menu);

    const content = document.createElement("main");
    content.setAttribute("data-base-ui-inert", "");
    content.setAttribute("inert", "");
    content.style.pointerEvents = "none";
    document.body.appendChild(content);
    document.body.style.pointerEvents = "none";

    expect(healOrphanedLocks(document)).toBe(false);
    // Locks preserved — we must never break an open overlay.
    expect(content.hasAttribute("inert")).toBe(true);
    expect(content.style.pointerEvents).toBe("none");
    expect(document.body.style.pointerEvents).toBe("none");
  });

  it("is a no-op when nothing is locked", () => {
    document.body.innerHTML = '<main><button>ok</button></main>';
    expect(healOrphanedLocks(document)).toBe(false);
  });

  it("also skips when an open dialog or listbox is present", () => {
    for (const role of ["dialog", "listbox"]) {
      document.body.innerHTML = "";
      const overlay = document.createElement("div");
      overlay.setAttribute("role", role);
      document.body.appendChild(overlay);
      const content = document.createElement("main");
      content.setAttribute("data-base-ui-inert", "");
      content.setAttribute("inert", "");
      document.body.appendChild(content);
      expect(healOrphanedLocks(document)).toBe(false);
      expect(content.hasAttribute("inert")).toBe(true);
    }
  });
});
