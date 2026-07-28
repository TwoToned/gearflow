// @vitest-environment jsdom
//
// #990 (Phase E) "legible lock" smoke tests — renders the actual overlay
// components OPEN (not just a closed trigger) per CLAUDE.md's overlay-test
// rule, and for the tooltip-driven surfaces (`LockedField`, `GatedButton`,
// `ProjectLockChip`, `ProjectLockGlyph`) actually opens the tooltip via
// focus rather than asserting on the closed DOM.
import React from "react";
import { describe, it, expect, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

import { LockedField } from "@/components/ui/locked-field";
import { GatedButton } from "@/components/ui/gated-button";
import { Input } from "@/components/ui/input";
import { ProjectLockChip } from "@/components/projects/project-lock-chip";
import { ProjectLockGlyph } from "@/components/projects/project-lock-glyph";
import { resolveLockCopy, formatLockElapsed, type LockCopyStatus } from "@/lib/lock-copy";

// Radix Tooltip opens on focus after `delayDuration` (default 700ms) — real
// timers, not faked, so this waits out the actual delay rather than assuming
// synchronous open.
async function openByFocus(trigger: HTMLElement) {
  fireEvent.focus(trigger);
  await waitFor(() => expect(screen.getByRole("tooltip")).toBeTruthy(), { timeout: 2000 });
}

describe("LockedField smoke", () => {
  it("passes an unlocked field through untouched — no fieldset, no lock glyph", () => {
    render(
      <LockedField locked={false} reason="Pricing is locked.">
        <Input aria-label="Price" defaultValue="100" />
      </LockedField>,
    );
    const input = screen.getByLabelText("Price") as HTMLInputElement;
    expect(input.disabled).toBe(false);
    fireEvent.change(input, { target: { value: "200" } });
    expect(input.value).toBe("200");
  });

  it("renders a locked field as a disabled fieldset and opens its tooltip with the reason + exit", async () => {
    const onExit = () => {};
    render(
      <LockedField locked reason="Pricing locked — this job is confirmed." exitLabel="Unlock financials" onExit={onExit}>
        <Input aria-label="Price" defaultValue="100" />
      </LockedField>,
    );
    const input = screen.getByLabelText("Price") as HTMLInputElement;
    const fieldset = input.closest("fieldset") as HTMLFieldSetElement;
    expect(fieldset).toBeTruthy();
    // A real browser cascades `:disabled` from `<fieldset disabled>` onto every
    // descendant form control natively (which is why `<LockedField>` uses a
    // fieldset rather than cloning `disabled` onto the child — see its
    // doc-comment). jsdom doesn't implement that cascade
    // (https://github.com/jsdom/jsdom — form-association is incomplete), so
    // this asserts what our own code controls: the fieldset itself is
    // disabled and is the thing a keyboard user actually lands on.
    expect(fieldset.disabled).toBe(true);
    expect(fieldset.tabIndex).toBe(0);

    await openByFocus(fieldset);
    expect(screen.getByText(/Pricing locked — this job is confirmed\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unlock financials" })).toBeTruthy();
  });
});

describe("GatedButton smoke", () => {
  it("fires onClick normally when not gated", () => {
    let clicked = false;
    render(
      <GatedButton gated={false} reason="unused" onClick={() => (clicked = true)}>
        Delete
      </GatedButton>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(clicked).toBe(true);
  });

  it("renders aria-disabled (not disabled), blocks the click, and opens its tooltip", async () => {
    let clicked = false;
    render(
      <GatedButton
        gated
        reason="Locked — this job is completed."
        exitLabel="Open full unlock session"
        onExit={() => {}}
        onClick={() => (clicked = true)}
      >
        Delete
      </GatedButton>,
    );
    const button = screen.getByRole("button", { name: "Delete" });
    // aria-disabled, NOT the `disabled` attribute — a real `disabled` button
    // fires no pointer events, so its tooltip could never open (§7.4).
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.tabIndex).not.toBe(-1);

    fireEvent.click(button);
    expect(clicked).toBe(false);

    await openByFocus(button);
    expect(screen.getByText(/Locked — this job is completed\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open full unlock session" })).toBeTruthy();
  });
});

describe("ProjectLockChip smoke", () => {
  it("renders nothing for OPEN with no open session — absence is the state", () => {
    const { container } = render(<ProjectLockChip status={{ tier: "OPEN", loading: false }} now={Date.now()} />);
    expect(container.textContent).toBe("");
  });

  it("renders 'Pricing locked' for FINANCE_LOCKED and opens its tooltip", async () => {
    render(<ProjectLockChip status={{ tier: "FINANCE_LOCKED", reason: "STATUS", loading: false }} now={Date.now()} />);
    const chip = screen.getByRole("button", { name: /Pricing locked/i });
    expect(chip).toBeTruthy();
    await openByFocus(chip);
    expect(screen.getByText(/Pricing locked — this job is confirmed\./)).toBeTruthy();
  });

  it("renders the live 'Unlocked by' state while a session is open", () => {
    render(
      <ProjectLockChip
        status={{
          tier: "FINANCE_LOCKED",
          hasOpenSession: true,
          openSession: { scope: "FINANCIAL", justification: "Client requested a discount.", openedByName: "Bob", openedAt: Date.now() - 5 * 60_000, snapshotId: "snap1" },
          loading: false,
        }}
        now={Date.now()}
      />,
    );
    expect(screen.getByRole("button", { name: /Unlocked by Bob/i })).toBeTruthy();
  });
});

describe("ProjectLockGlyph smoke", () => {
  it("renders nothing for an OPEN-tier status", () => {
    const { container } = render(<ProjectLockGlyph status="QUOTING" />);
    expect(container.textContent).toBe("");
  });

  it("renders the glyph for a CONFIRMED (FINANCE_LOCKED) status and opens its tooltip", async () => {
    render(<ProjectLockGlyph status="CONFIRMED" />);
    const glyph = screen.getByLabelText(/Pricing locked/i);
    await openByFocus(glyph);
    expect(screen.getByText(/Pricing locked — this job is confirmed\./)).toBeTruthy();
  });

  it("renders the glyph for a COMPLETED (HARD_LOCKED) status", () => {
    render(<ProjectLockGlyph status="COMPLETED" />);
    expect(screen.getByLabelText(/^Locked/i)).toBeTruthy();
  });
});

describe("resolveLockCopy / formatLockElapsed", () => {
  const now = Date.UTC(2026, 6, 28, 12, 0, 0);

  it("every tier × reason combination produces distinct, non-empty copy — never colour-only", () => {
    const cases: LockCopyStatus[] = [
      { tier: "OPEN" },
      { tier: "FINANCE_LOCKED", reason: "STATUS", revision: 2 },
      { tier: "FINANCE_LOCKED", reason: "QUOTE_SENT", revision: 2 },
      { tier: "JUSTIFY", reason: "STATUS" },
      { tier: "HARD_LOCKED", reason: "STATUS" },
    ];
    const seen = new Set<string>();
    for (const status of cases) {
      const copy = resolveLockCopy(status, now);
      expect(copy.headline.length).toBeGreaterThan(0);
      expect(copy.oneLiner.length).toBeGreaterThan(0);
      seen.add(copy.oneLiner);
    }
    expect(seen.size).toBe(cases.length);
  });

  it("QUOTE_SENT names the next version as the exit", () => {
    const copy = resolveLockCopy({ tier: "FINANCE_LOCKED", reason: "QUOTE_SENT", revision: 2 }, now);
    expect(copy.exitLabel).toBe("Create quote v3");
  });

  it("an open session's copy carries the elapsed time and the justification", () => {
    const copy = resolveLockCopy(
      {
        tier: "FINANCE_LOCKED",
        hasOpenSession: true,
        openSession: { scope: "FINANCIAL", justification: "Client added two movers", openedByName: "Jayden", openedAt: now - 12 * 60_000, snapshotId: "s1" },
      },
      now,
    );
    expect(copy.headline).toContain("12m");
    expect(copy.headline).toContain("Jayden");
    expect(copy.detail).toContain("Client added two movers");
  });

  it("formats elapsed time per the §7.2 spec: minutes, hours+minutes, then a 3h+ ceiling", () => {
    expect(formatLockElapsed(now - 12 * 60_000, now)).toBe("12m");
    expect(formatLockElapsed(now - 64 * 60_000, now)).toBe("1h 4m");
    expect(formatLockElapsed(now - 4 * 60 * 60_000, now)).toBe("3h+");
  });
});
