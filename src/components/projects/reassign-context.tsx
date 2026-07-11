"use client";

import { createContext, useContext } from "react";

/**
 * Per-unit reassignment wiring for the equipment tab. Provided once at the tab
 * level (which has the whole line-item tree) and consumed by the per-unit rows
 * deep inside LineItemRow — avoids threading candidate targets + a handler
 * through every LineItemRow call site. When no provider is present (e.g. the
 * read-only pull-sheet), `useReassign()` returns null and the row renders no
 * reassign control.
 */
export interface ReassignTarget {
  /** Target line item id. */
  id: string;
  /** Human label — the container (category / group) that disambiguates two
   *  same-model lines (e.g. "Band Mics" vs "Drum Kit Mic Set"). */
  label: string;
  /** Target is already fully assigned — offered but disabled. */
  full: boolean;
}

export interface ReassignContextValue {
  /** modelId → candidate target lines on this project (same model). */
  targetsByModel: Map<string, ReassignTarget[]>;
  /** Move a unit's binding to another line. Fire-and-forget; the live Convex
   *  subscription reflects the result. */
  reassign: (unitId: string, targetLineItemId: string) => void;
  /** Unit currently mid-move (disables its control). */
  pendingUnitId: string | null;
}

const ReassignContext = createContext<ReassignContextValue | null>(null);

export const ReassignProvider = ReassignContext.Provider;

export function useReassign(): ReassignContextValue | null {
  return useContext(ReassignContext);
}
