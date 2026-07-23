import { ConvexError } from "convex/values";

/**
 * Generic string/number bound guards for the PUBLIC browser-callable write mutations
 * (R-8.6.2). Convex `v.string()`/`v.number()` only enforce TYPE, not the `.min()`/
 * `.max()` business constraints `src/lib/validations/*` enforce client-side — a caller
 * invoking the mutation directly (valid session, bypassing the UI/Zod) skips those
 * entirely. These primitives let each `convex/*Writes.ts` file mirror the same bounds
 * as its paired Zod schema in a couple of lines instead of hand-rolling the same
 * `if (...) throw` shape N times (see `moneyGuards.ts` for the money-specific
 * precedent this generalises).
 */

/** Reject a string outside [min, max] length. `null`/`undefined` skip (optional field). */
export function assertStrLen(
  value: string | null | undefined,
  field: string,
  bounds: { min?: number; max?: number },
): void {
  if (value == null) return;
  if (bounds.min != null && value.length < bounds.min) {
    throw new ConvexError({ code: "INVALID_FIELD", message: `${field} must be at least ${bounds.min} character(s).` });
  }
  if (bounds.max != null && value.length > bounds.max) {
    throw new ConvexError({ code: "INVALID_FIELD", message: `${field} must be at most ${bounds.max} characters.` });
  }
}

/** Reject a non-finite number, or one outside [min, max] / non-integer. `null`/`undefined` skip. */
export function assertNumRange(
  value: number | null | undefined,
  field: string,
  bounds: { min?: number; max?: number; integer?: boolean },
): void {
  if (value == null) return;
  if (!Number.isFinite(value)) {
    throw new ConvexError({ code: "INVALID_FIELD", message: `${field} must be a finite number.` });
  }
  if (bounds.integer && !Number.isInteger(value)) {
    throw new ConvexError({ code: "INVALID_FIELD", message: `${field} must be a whole number.` });
  }
  if (bounds.min != null && value < bounds.min) {
    throw new ConvexError({ code: "INVALID_FIELD", message: `${field} must be at least ${bounds.min}.` });
  }
  if (bounds.max != null && value > bounds.max) {
    throw new ConvexError({ code: "INVALID_FIELD", message: `${field} must be at most ${bounds.max}.` });
  }
}

/** Reject an array with more than `max` entries. `null`/`undefined` skip. */
export function assertArrayMax(value: unknown[] | null | undefined, field: string, max: number): void {
  if (value == null) return;
  if (value.length > max) {
    throw new ConvexError({ code: "INVALID_FIELD", message: `${field} must have at most ${max} entries.` });
  }
}
