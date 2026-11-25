import { v } from "convex/values";

/**
 * Pure facts for the supplier record's Contacts / Documents tabs and the order's Files
 * tab (UX Phase 13, slice B3). One definition shared by the schema, the write guards,
 * the UI and the tests (R-3.1).
 */

/** Kinds of file on a supplier order. The invoice keeps its own 1:1 slot (`invoiceFileId`). */
export const ORDER_FILE_KINDS = ["PO", "DOCKET", "OTHER"] as const;
export type OrderFileKind = (typeof ORDER_FILE_KINDS)[number];
export const orderFileKind = v.union(v.literal("PO"), v.literal("DOCKET"), v.literal("OTHER"));

export const ORDER_FILE_KIND_LABELS: Record<OrderFileKind, string> = { PO: "Purchase order", DOCKET: "Docket", OTHER: "Other" };

/** Caps that bound the child lists every read collects. */
export const MAX_CONTACTS_PER_SUPPLIER = 50;
export const MAX_DOCUMENTS_PER_SUPPLIER = 100;
export const MAX_FILES_PER_ORDER = 50;

const DAY_MS = 86_400_000;
export const EXPIRY_WARN_DAYS = 30;

export type ExpiryState = "none" | "ok" | "soon" | "expired";

/** A document's expiry, DERIVED from its stored date and today (never stored). */
export function documentExpiry(expiryDate: number | null | undefined, now: number): { state: ExpiryState; days: number | null } {
  if (expiryDate == null) return { state: "none", days: null };
  const days = Math.floor((expiryDate - now) / DAY_MS);
  if (expiryDate < now) return { state: "expired", days };
  return { state: days <= EXPIRY_WARN_DAYS ? "soon" : "ok", days };
}

/** Usefulness floor for a contact: at least a name, email or phone. */
export function contactHasSubstance(f: { name?: string | null; email?: string | null; phone?: string | null }): boolean {
  return !!(f.name || f.email || f.phone);
}
