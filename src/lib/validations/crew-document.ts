import { z } from "zod";

import { CREW_DOCUMENT_KINDS } from "../../../convex/lib/crewDocumentCore";

/**
 * The crew-document form (UX Phase 13, D72). Mirrors the bounds `convex/crewDocumentsWrites.ts`
 * enforces server-side (the browser's parse is bypassable). `expiry` is an `<input type="date">`
 * string, turned into epoch-ms by `fromDateInput` at submit.
 */
export const crewDocumentSchema = z.object({
  kind: z.enum(CREW_DOCUMENT_KINDS),
  name: z.string().max(200).optional(),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date").optional().or(z.literal("")),
});

export type CrewDocumentFormValues = z.input<typeof crewDocumentSchema>;
