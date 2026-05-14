/**
 * Client-side error display helper (Wave 2 Item 2.A).
 *
 * Replaces the `toast.error(e.message)` pattern (340 callsites across 100
 * files) with a structured toast that renders title + message + optional
 * hint. Falls back gracefully to a plain "Something went wrong" toast for
 * unknown errors so callers never have to worry about the unhappy path.
 *
 * Usage:
 *
 *   onError: (e) => showError(e)
 *
 *   // With an override title (e.g. for a specific button context):
 *   onError: (e) => showError(e, { fallbackTitle: "Could not deploy asset" })
 *
 * Branches on UserFacingError shape (set by `withAction` on the server) and
 * on the small set of legacy structured errors (TestTagBlockError,
 * InventoryError) that already carry context.
 */

import { toast } from "sonner";
import { isUserFacingError } from "./errors/user-facing-error";

interface ShowErrorOptions {
  /** Title used when the error does not provide its own. */
  fallbackTitle?: string;
  /** Action button label (e.g. "Retry"). */
  actionLabel?: string;
  /** Callback when the action button is clicked. */
  onAction?: () => void;
}

export function showError(e: unknown, opts: ShowErrorOptions = {}): void {
  const fallbackTitle = opts.fallbackTitle ?? "Something went wrong";

  // UserFacingError (server-side, from `withAction` translation): title + message + hint.
  if (isUserFacingError(e)) {
    toast.error(e.title, {
      description: [e.message, e.hint].filter(Boolean).join(" "),
      action: opts.onAction
        ? { label: opts.actionLabel ?? "Retry", onClick: opts.onAction }
        : undefined,
    });
    return;
  }

  // Legacy structured errors — pull a sensible title out of the name.
  if (e instanceof Error && e.name === "TestTagBlockError") {
    toast.error("Test & Tag block", {
      description: e.message,
      duration: 10000, // compliance block — keep visible longer
    });
    return;
  }

  if (e instanceof Error && e.name === "InventoryError") {
    toast.error("Inventory error", {
      description: e.message,
    });
    return;
  }

  // Unknown error — use the fallback title + raw message if any.
  const description =
    e instanceof Error && e.message
      ? e.message
      : typeof e === "string"
        ? e
        : "An unexpected error occurred. Please try again.";

  toast.error(fallbackTitle, {
    description,
    action: opts.onAction
      ? { label: opts.actionLabel ?? "Retry", onClick: opts.onAction }
      : undefined,
  });
}
