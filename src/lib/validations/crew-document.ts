import { z } from "zod";

import { CREW_DOCUMENT_EXPIRY_MAX_MS, CREW_DOCUMENT_EXPIRY_MIN_MS, CREW_DOCUMENT_KINDS } from "../../../convex/lib/crewDocumentCore";

const inExpiryRange = (day: string) => {
  const ms = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(ms) && ms >= CREW_DOCUMENT_EXPIRY_MIN_MS && ms < CREW_DOCUMENT_EXPIRY_MAX_MS;
};

/**
 * The crew-document form (UX Phase 13, D72). Mirrors the bounds `convex/crewDocumentsWrites.ts`
 * enforces server-side (the browser's parse is bypassable). `expiry` is an `<input type="date">`
 * string, turned into epoch-ms by `fromDateInput` at submit.
 */
export const crewDocumentSchema = z.object({
  kind: z.enum(CREW_DOCUMENT_KINDS),
  name: z.string().max(200).optional(),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date").refine(inExpiryRange, "Use a date between 1970 and 2099").optional().or(z.literal("")),
});

