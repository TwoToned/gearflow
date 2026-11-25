import { v } from "convex/values";

/**
 * Pure facts for crew documents (UX Phase 13, D72): licences, tickets, insurance, contracts and
 * ID, with an optional expiry. Identity and licence material (R-8.12), so access is the
 * tightest in the app: one rule, `crewDocumentsVisible`, shared by every Convex read, by the
 * write guard and by the Next.js download route (which cannot import a Convex ctx).
 */

export const CREW_DOCUMENT_KINDS = ["LICENCE", "TICKET", "INSURANCE", "CONTRACT", "ID", "OTHER"] as const;
export type CrewDocumentKind = (typeof CREW_DOCUMENT_KINDS)[number];
export const crewDocumentKind = v.union(v.literal("LICENCE"), v.literal("TICKET"), v.literal("INSURANCE"), v.literal("CONTRACT"), v.literal("ID"), v.literal("OTHER"));

export const CREW_DOCUMENT_KIND_LABELS: Record<CrewDocumentKind, string> = {
  LICENCE: "Licence", TICKET: "Ticket", INSURANCE: "Insurance", CONTRACT: "Contract", ID: "ID", OTHER: "Other",
};

/** The `storedFiles.folder` every crew document's bytes live in. `/api/files` REFUSES this folder. */
export const CREW_DOCUMENTS_FOLDER = "crew-documents";

/** Caps that bound the member's document list. */
export const MAX_CREW_DOCUMENTS = 100;

/**
 * THE visibility rule (owner ruling B2, 2026-11-24): the member themself (the row's linked
 * user) or a caller with `crew:update`, on a USER session. Never an API key or agent, never a
 * `crew:read`-only role (warehouse, viewer). It covers the list, the names, the files AND the
 * expiry health: someone who may not open the document may not learn that it lapsed either.
 */
export function crewDocumentsVisible(a: { userSession: boolean; managesCrew: boolean; isSelf: boolean }): boolean {
  return a.userSession && (a.managesCrew || a.isSelf);
}

const DAY_MS = 86_400_000;
export const CREW_DOC_WARN_DAYS = 30;

export type CrewDocHealthState = "expired" | "soon" | "ok" | "none";

/** A document's expiry, DERIVED from the stored date and today (never stored). */
export function crewDocumentExpiry(expiresAt: number | null | undefined, now: number): { state: CrewDocHealthState; days: number | null } {
  if (expiresAt == null) return { state: "none", days: null };
  const days = Math.floor((expiresAt - now) / DAY_MS);
  if (expiresAt < now) return { state: "expired", days };
  return { state: days <= CREW_DOC_WARN_DAYS ? "soon" : "ok", days };
}

/** The worst document of a set (expired, then soonest to lapse), as the Overview health row. */
export function worstCrewDocument<D extends { expiresAt?: number | null }>(docs: D[], now: number): { doc: D; state: CrewDocHealthState; days: number } | null {
  let best: { doc: D; state: CrewDocHealthState; days: number } | null = null;
  for (const doc of docs) {
    const e = crewDocumentExpiry(doc.expiresAt, now);
    if ((e.state !== "expired" && e.state !== "soon") || e.days == null) continue;
    if (!best || e.days < best.days) best = { doc, state: e.state, days: e.days };
  }
  return best;
}
