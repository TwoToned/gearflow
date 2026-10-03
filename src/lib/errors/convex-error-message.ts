import { ConvexError } from "convex/values";

/**
 * Turn whatever a Convex mutation threw into a message safe to show a user.
 *
 * Every Convex mutation in this codebase throws `ConvexError({ code, message })`
 * (CLAUDE.md "Convex Mutation Rules") — `.data.message` is the human-readable
 * text a mutation author actually wrote for this failure. `.message` on the
 * `ConvexError` ITSELF is the raw `"[CONVEX M(module:fn)] Server Error\nUncaught
 * ConvexError: {...}\n    at ..."` wrapper the Convex client stitches together
 * for logging — that string must never reach a toast or inline error, which is
 * exactly the "random convex error" bug class this closes. A bare
 * `throw new ConvexError("some string")` stores the string itself as `.data`,
 * so that's checked too. Extracted from a duplicate copy that lived in
 * `line-item-inline-cells.tsx` (R-3.1 — one place, not one per call site).
 */
export function convexErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof ConvexError) {
    const data = e.data;
    if (data && typeof data === "object") {
      const message = (data as { message?: unknown }).message;
      if (typeof message === "string" && message) return message;
    }
    if (typeof data === "string" && data) return data;
    return fallback;
  }
  if (e instanceof Error) {
    // Convex masks a plain (non-ConvexError) throw in production to
    // `"[CONVEX M(mod:fn)] [Request ID: abc123] Server Error"` — nothing in it is
    // written for a human. Say it's on us, and keep the request id so support can
    // find the server log.
    if (isMaskedServerError(e.message)) {
      const ref = /Request ID: ([\w-]+)/.exec(e.message)?.[1];
      return `Something went wrong on our side${ref ? ` (ref ${ref})` : ""}. Please try again, and contact support if it keeps happening.`;
    }
    // A non-ConvexError Error (client-side validation, "No active organization",
    // a thrown plain string, …) already carries a message written for a human.
    return e.message;
  }
  return fallback;
}

/** The raw wrapper Convex builds around any server-side failure. */
export function isMaskedServerError(message: string): boolean {
  return /^\s*\[CONVEX [MQA]\(/.test(message) || /\bServer Error\b/.test(message);
}
