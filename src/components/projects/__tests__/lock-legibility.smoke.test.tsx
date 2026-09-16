// @vitest-environment jsdom
//
// #990 (Phase E) "legible lock" smoke tests, shrunk for #1230's single
// pricingLocked boolean — renders the actual overlay components OPEN (not
// just a closed trigger) per CLAUDE.md's overlay-test rule, and for the
// tooltip-driven surfaces (`LockedField`, `GatedButton`, `ProjectLockChip`,
// `ProjectLockGlyph`) actually opens the tooltip via focus rather than
// asserting on the closed DOM. `LockedField`/`GatedButton` are unchanged by
// #1230 (still a plain `locked`/`gated` boolean + `reason` string) —
// `ProjectLockChip`/`ProjectLockGlyph`/`resolveLockCopy`/`formatLockElapsed`
// are the SHRUNKEN successors of #990's tier-based versions.
import React from "react";
import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
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
      <LockedField locked reason="Pricing locked — this job is confirmed." exitLabel="Unlock pricing" onExit={onExit}>
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
    expect(screen.getByRole("button", { name: "Unlock pricing" })).toBeTruthy();
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
        reason="Pricing locked — this job is confirmed."
        exitLabel="Unlock pricing"
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
    expect(screen.getByText(/Pricing locked — this job is confirmed\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unlock pricing" })).toBeTruthy();
  });
});

describe("ProjectLockChip smoke", () => {
  it("renders nothing while loading", () => {
    const { container } = render(<ProjectLockChip status={{ pricingLocked: false, loading: true }} />);
    expect(container.textContent).toBe("");
  });

  it("renders nothing when pricing is open — absence is the state", () => {
    const { container } = render(<ProjectLockChip status={{ pricingLocked: false, loading: false }} />);
    expect(container.textContent).toBe("");
  });

  it("renders 'Pricing locked' and opens its tooltip", async () => {
    render(<ProjectLockChip status={{ pricingLocked: true, pricingLockedByName: "Bob", loading: false }} />);
    const chip = screen.getByRole("button", { name: /Pricing locked/i });
    expect(chip).toBeTruthy();
    await openByFocus(chip);
    expect(screen.getByRole("tooltip").textContent).toMatch(/Pricing locked/);
  });
});

describe("ProjectLockGlyph smoke", () => {
  it("renders nothing for a pre-CONFIRMED status", () => {
    const { container } = render(<ProjectLockGlyph status="QUOTING" />);
    expect(container.textContent).toBe("");
  });

  it("renders the glyph for a CONFIRMED status and opens its tooltip", async () => {
    render(<ProjectLockGlyph status="CONFIRMED" />);
    const glyph = screen.getByLabelText(/Pricing locked/i);
    await openByFocus(glyph);
    expect(screen.getByText(/Pricing locked — this job is confirmed\./)).toBeTruthy();
  });

  // #1230: HARD_LOCKED is deleted — CONFIRMED and COMPLETED render the
  // identical glyph/label now (`isConfirmedOrLater`, status-only).
  it("renders the SAME glyph/label for a COMPLETED status — no separate HARD_LOCKED wording", () => {
    render(<ProjectLockGlyph status="COMPLETED" />);
    expect(screen.getByLabelText(/Pricing locked — this job is confirmed\./i)).toBeTruthy();
  });
});

describe("resolveLockCopy / formatLockElapsed", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pricing open produces distinct, non-empty, unlocked copy", () => {
    const copy = resolveLockCopy({ pricingLocked: false });
    expect(copy.chipLabel).toBeNull();
    expect(copy.exitLabel).toBeNull();
    expect(copy.headline.length).toBeGreaterThan(0);
    expect(copy.oneLiner.length).toBeGreaterThan(0);
  });

  it("pricing locked produces a distinct chip label, exit CTA and non-empty copy", () => {
    const copy = resolveLockCopy({ pricingLocked: true, pricingLockedByName: "Jayden" });
    expect(copy.chipLabel).toBe("Pricing locked");
    expect(copy.exitLabel).toBe("Unlock pricing");
    expect(copy.headline.length).toBeGreaterThan(0);
    expect(copy.oneLiner).not.toBe(resolveLockCopy({ pricingLocked: false }).oneLiner);
    expect(copy.detail).toContain("Jayden");
  });

  it("formats elapsed time: same day, yesterday, N days ago, then a locale date", () => {
    const now = Date.UTC(2026, 6, 28, 12, 0, 0);
    expect(formatLockElapsed(now - 60_000, now)).toBe("today");
    expect(formatLockElapsed(now - 25 * 60 * 60_000, now)).toBe("yesterday");
    expect(formatLockElapsed(now - 3 * 86_400_000, now)).toBe("3d ago");
    expect(formatLockElapsed(now - 10 * 86_400_000, now)).toBe(new Date(now - 10 * 86_400_000).toLocaleDateString());
  });

  it("a LockCopyStatus with no pricingLockedAt omits the elapsed-time clause", () => {
    const copy = resolveLockCopy({ pricingLocked: true } satisfies LockCopyStatus);
    expect(copy.detail).not.toMatch(/\(/);
  });
});
