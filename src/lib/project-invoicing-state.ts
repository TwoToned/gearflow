/**
 * Re-export of the invoicing-state derivation. The rule lives in `convex/lib/invoicingState.ts` so the
 * Convex reads (the Finance hub's `Deposit due`) and the job page share ONE definition (R-3.1), the same
 * isomorphic-module pattern as `permissionsCore`.
 */
export * from "../../convex/lib/invoicingState";
