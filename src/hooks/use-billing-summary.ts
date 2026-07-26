"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession } from "@/lib/auth-client";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";

/**
 * #943 — the derived billing-weeks/days summary's manual override + the
 * stale-price "recalculate" flow.
 *
 * Setting the override goes straight through `projectWrites.updateNative`'s
 * generic set/clear (rather than the full `useProjectWrites().update()`,
 * which requires a complete `ProjectFormValues` including `name`) — this is a
 * narrow two-field patch, so there's no form to round-trip through.
 * `assertProjectMoneyFields` bound-checks both fields server-side regardless
 * of which path calls in (R-8.6.2).
 */
export function useBillingOverride(orgId: string | undefined) {
  const { data: session } = useSession();
  const updateM = useMutation(api.projectWrites.updateNative);

  /** `null` for either field CLEARS that override (reverts to derived). */
  const setOverride = async (
    projectId: string,
    weeks: number | null,
    days: number | null,
  ): Promise<void> => {
    if (!orgId || !session?.user) throw new Error("Not ready");
    const set: Record<string, unknown> = { updatedAt: Date.now() };
    const clear: string[] = [];
    if (weeks == null) clear.push("billingWeeksOverride");
    else set.billingWeeksOverride = weeks;
    if (days == null) clear.push("billingDaysOverride");
    else set.billingDaysOverride = days;

    await updateM({
      id: projectId,
      orgId,
      set,
      clear,
      actor: { userId: session.user.id, userName: session.user.name ?? "" },
      auditId: createId(),
      now: Date.now(),
    });
  };

  /** Revert both fields to derived (absent = derived from rental dates). */
  const clearOverride = (projectId: string): Promise<void> => setOverride(projectId, null, null);

  return { setOverride, clearOverride };
}

/**
 * Stale-price detection (read side) — drives the "Rates derived from old
 * dates — recalculate" banner. `undefined` while loading/unauthenticated;
 * treat as "not stale" (no banner flash) until the real count lands.
 */
export function useProjectPricingStaleness(
  projectId: string | undefined,
  orgId: string | undefined,
): number {
  const result = useAuthedQuery(
    api.lineItemWrites.projectPricingStaleness,
    projectId && orgId ? { projectId, orgId } : "skip",
  );
  return result?.staleLineCount ?? 0;
}

/** Recalculate (write side) — recomputes every non-overridden auto-priced
 *  line from the project's CURRENT rental dates. Never silent: the caller is
 *  always an explicit user click on the stale-price banner. */
export function useRecalcAutoPricedLines(orgId: string | undefined) {
  const { data: session } = useSession();
  const recalcM = useMutation(api.lineItemWrites.recalcAutoPricedLinesNative);

  const recalc = async (projectId: string): Promise<{ linesUpdated: number; groupsUpdated: number }> => {
    if (!orgId || !session?.user) throw new Error("Not ready");
    return recalcM({
      projectId,
      orgId,
      actor: { userId: session.user.id, userName: session.user.name ?? "" },
      auditId: createId(),
      now: Date.now(),
    });
  };

  return { recalc };
}
