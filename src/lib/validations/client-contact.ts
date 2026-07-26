import { z } from "zod";

/**
 * ClientContact form schema (WS9 #948). Mirrors `clientContactFields`
 * (convex/clientContactWrites.ts) field-for-field (R-8.6.1 — checked by
 * convex/validationDrift.test.ts). Usefulness floor: at least one of
 * {name, email, phone} — duplicate email on one client is allowed (spec decision,
 * the UI warns but doesn't hard-block).
 */
export const clientContactSchema = z
  .object({
    name: z.string().max(200).optional(),
    role: z.string().max(100).optional(),
    email: z.string().email("Invalid email").max(200).optional().or(z.literal("")),
    phone: z.string().max(50).optional(),
    notes: z.string().max(500).optional(),
    isPrimary: z.boolean().optional(),
  })
  .refine((data) => !!(data.name || data.email || data.phone), {
    message: "Provide at least a name, email, or phone number.",
  });

export type ClientContactFormValues = z.input<typeof clientContactSchema>;
