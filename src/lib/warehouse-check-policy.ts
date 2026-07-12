/**
 * Central policy for "does this warehouse transition fire an equipment check?"
 *
 * The gating logic used to be copy-pasted across ~7 handlers in the warehouse
 * page (each re-deriving `model._count.modelCheckItems > 0` and branching on
 * context), which is exactly why check coverage drifted per transition. This
 * module is the single source of truth. Callers pass the transition + whether the
 * model/kit carries check items; the policy decides.
 *
 * Policy (product decision 2026-07):
 * - **PREP** (Pick → Prep): fire a check when the model/kit has check items. This
 *   is THE outbound gate — items are verified once, at prep.
 * - **RETURN at DE-PREP** (shelf-in, `fromDeprep: true`): fire a check when the
 *   model/kit has check items. This is the condition check as gear is stowed.
 * - **RETURN at return-scan** (truck-in, `fromDeprep` false/absent): **no check.**
 *   The return check fires only at de-prep, not when the item first comes back.
 * - **Deploy** (Prep → Checked-out): no check (prep is the gate) — there is no
 *   `CheckContext` for it, so it simply never calls this.
 */
export type CheckContext = "PREP" | "RETURN";

export function transitionNeedsCheck(
  context: CheckContext,
  opts: { hasCheckItems: boolean; fromDeprep?: boolean },
): boolean {
  if (!opts.hasCheckItems) return false;
  if (context === "PREP") return true;
  // context === "RETURN": only at de-prep (shelf-in), never at return-scan (truck-in).
  return opts.fromDeprep === true;
}

/** True when a line's model carries ≥1 check item (dedupes the ~7 inline copies). */
export function lineHasModelChecks(
  li: { model?: { _count?: { modelCheckItems?: number } | null } | null } | null | undefined,
): boolean {
  const n = li?.model?._count?.modelCheckItems;
  return typeof n === "number" && n > 0;
}

/** True when a kit carries ≥1 kit-level check item. */
export function kitHasChecks(
  kit: { _count?: { kitCheckItems?: number } | null } | null | undefined,
): boolean {
  const n = kit?._count?.kitCheckItems;
  return typeof n === "number" && n > 0;
}
