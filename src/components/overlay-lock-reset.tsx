"use client";

import { useEffect } from "react";

/**
 * Self-heals the "whole page becomes unclickable until you refresh" bug.
 *
 * While a modal overlay (menu, dialog, select, popover) is open, Base UI /
 * Floating UI makes the rest of the page inert: it renders a full-screen
 * `InternalBackdrop` (`[data-base-ui-inert][role="presentation"]`, which captures
 * every click) AND marks sibling elements with `data-base-ui-inert` plus
 * `inert` / `aria-hidden="true"` / `pointer-events: none`, restoring them when
 * the overlay closes. Under React 19, when an overlay unmounts during a route
 * change (or a render throws mid-open) that restore sometimes never runs, so the
 * backdrop and inert markers are orphaned and the entire page stops responding
 * to clicks. A manual refresh is the only recovery. This is a long-standing
 * issue in this app (see the existing DomPatch / removeChild machinery); it just
 * became far more frequent once dropdown menus landed on every list page.
 *
 * This watchdog runs only when NO overlay is actually open. In that state any
 * `data-base-ui-inert` is provably orphaned, so it is safe to remove the
 * backdrop and un-inert the real content. The "no open overlay" guard means it
 * never touches a legitimately open menu/dialog. A polling interval (not an
 * event listener) is required because the freeze itself swallows pointer events,
 * so there is no user interaction to hook onto.
 */

/**
 * True when a real Base UI overlay is currently open (so its inert locks are
 * legitimate and must be left alone). We key off the popup CONTENT roles
 * (menu/dialog/listbox), which Base UI unmounts on close — so their presence
 * reliably means "open". We deliberately do NOT key off trigger attributes like
 * `data-open` / `data-popup-open`: those live on persistent trigger elements and
 * can themselves get stuck in the exact unmount-during-nav failure we're
 * healing, which would block recovery forever.
 */
function anyOverlayOpen(doc: Document): boolean {
  return !!doc.querySelector(
    '[role="dialog"]:not([hidden]), [role="menu"]:not([hidden]), [role="listbox"]:not([hidden])',
  );
}

/** Clear orphaned inert locks. Returns true if anything was healed. */
export function healOrphanedLocks(doc: Document = document): boolean {
  if (anyOverlayOpen(doc)) return false;

  let healed = false;
  doc.querySelectorAll("[data-base-ui-inert]").forEach((el) => {
    const node = el as HTMLElement;
    if (node.getAttribute("role") === "presentation") {
      // Orphaned full-screen backdrop — it captures every click. Remove it.
      node.remove();
      healed = true;
      return;
    }
    // Orphaned inert marker on real page content — restore interactivity.
    node.removeAttribute("data-base-ui-inert");
    node.removeAttribute("inert");
    node.removeAttribute("aria-hidden");
    if (node.style.pointerEvents === "none") node.style.pointerEvents = "";
    healed = true;
  });

  // Belt-and-braces: clear a stuck page-level pointer-events lock.
  if (doc.body.style.pointerEvents === "none") {
    doc.body.style.pointerEvents = "";
    healed = true;
  }
  if (doc.documentElement.style.pointerEvents === "none") {
    doc.documentElement.style.pointerEvents = "";
    healed = true;
  }
  return healed;
}

export function OverlayLockReset() {
  useEffect(() => {
    const interval = window.setInterval(() => healOrphanedLocks(), 800);
    // Also heal when the tab is re-focused (a common moment to notice the freeze).
    const onVisible = () => {
      if (document.visibilityState === "visible") healOrphanedLocks();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
