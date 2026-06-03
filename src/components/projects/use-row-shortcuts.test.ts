// @vitest-environment jsdom
/**
 * Tests for the per-row keyboard shortcut hook (Decision 8J).
 *
 * Focus is on the suppression predicate — that's the part most likely
 * to regress in subtle ways (e.g., new portal-rendered popovers steal
 * focus and the shortcut starts firing on top of a typing user).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isShortcutSuppressed } from "./use-row-shortcuts";

function resetDom() {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
}

describe("isShortcutSuppressed", () => {
  beforeEach(resetDom);
  afterEach(resetDom);

  it("returns false when no element is focused", () => {
    // Body is the default activeElement when nothing has focus.
    expect(isShortcutSuppressed()).toBe(false);
  });

  it("returns true when an <input> has focus", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    expect(isShortcutSuppressed()).toBe(true);
  });

  it("returns true when a <textarea> has focus", () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();
    expect(isShortcutSuppressed()).toBe(true);
  });

  it("returns true when a contentEditable div has focus", () => {
    const div = document.createElement("div");
    // Use setAttribute directly — jsdom doesn't reliably propagate the
    // `div.contentEditable = "true"` accessor to the attribute / property.
    div.setAttribute("contenteditable", "true");
    div.tabIndex = 0;
    document.body.appendChild(div);
    div.focus();
    expect(isShortcutSuppressed()).toBe(true);
  });

  it('returns true when focus is inside a [role="dialog"]', () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const btn = document.createElement("button");
    dialog.appendChild(btn);
    document.body.appendChild(dialog);
    btn.focus();
    expect(isShortcutSuppressed()).toBe(true);
  });

  it('returns true when focus is inside a [role="menu"]', () => {
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("button");
    menu.appendChild(item);
    document.body.appendChild(menu);
    item.focus();
    expect(isShortcutSuppressed()).toBe(true);
  });

  it("returns false when a plain button has focus (the normal row case)", () => {
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    btn.focus();
    expect(isShortcutSuppressed()).toBe(false);
  });
});
