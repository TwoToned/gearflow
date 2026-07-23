import { z } from "zod";

export const DOCUMENT_TYPES = [
  "quote",
  "invoice",
  "packing-list",
  "return-sheet",
  "delivery-docket",
  "call-sheet",
] as const;

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  quote: "Quote",
  invoice: "Invoice",
  "packing-list": "Packing List",
  "return-sheet": "Return Sheet",
  "delivery-docket": "Delivery Docket",
  "call-sheet": "Call Sheet",
};

export const createDocumentTemplateSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  type: z.enum(DOCUMENT_TYPES),
  basePdf: z.string(), // JSON string
  schemas: z.string(), // JSON string
});

// R-8.6.3: derived from the create schema rather than re-declared — `type`
// isn't updatable, and every other field becomes optional on update.
export const updateDocumentTemplateSchema = createDocumentTemplateSchema
  .omit({ type: true })
  .partial()
  .extend({ id: z.string().min(1) });

export type CreateDocumentTemplateValues = z.input<typeof createDocumentTemplateSchema>;
export type UpdateDocumentTemplateValues = z.input<typeof updateDocumentTemplateSchema>;
