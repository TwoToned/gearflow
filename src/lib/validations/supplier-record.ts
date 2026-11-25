import { z } from "zod";

import { ORDER_FILE_KINDS } from "../../../convex/lib/supplierRecordCore";

/**
 * Form schemas for the supplier record's Contacts / Documents and the order's Files
 * (UX Phase 13, B3). They mirror the bounds `convex/supplierRecordWrites.ts` enforces
 * server-side (the browser's parse is bypassable; the server is the authority). Dates are
 * `<input type="date">` strings, turned into epoch-ms by `fromDateInput` at submit.
 */
export const supplierContactSchema = z
  .object({
    name: z.string().max(200).optional(),
    role: z.string().max(100).optional(),
    email: z.string().email("Invalid email").max(200).optional().or(z.literal("")),
    phone: z.string().max(50).optional(),
    notes: z.string().max(500).optional(),
  })
  .refine((d) => !!(d.name?.trim() || d.email?.trim() || d.phone?.trim()), { message: "Provide at least a name, email, or phone number." });

export type SupplierContactFormValues = z.input<typeof supplierContactSchema>;

export const supplierDocumentSchema = z.object({
  name: z.string().trim().min(1, "Give the document a name").max(200),
  kind: z.string().max(60).optional(),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date").optional().or(z.literal("")),
  notes: z.string().max(500).optional(),
});

export type SupplierDocumentFormValues = z.input<typeof supplierDocumentSchema>;

export const supplierOrderFileSchema = z.object({
  kind: z.enum(ORDER_FILE_KINDS),
  name: z.string().max(200).optional(),
});

