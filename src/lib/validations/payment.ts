import { z } from "zod";

/**
 * Payment record form (#1055). `id`/`organizationId`/`invoiceId` are create-time
 * args the hook supplies directly (mirrors invoiceSchema's split). No server-side
 * money is derived from this beyond echoing `amount` — `invoices.amountPaid`/
 * `paymentStatus` are recomputed in `paymentsWrites.ts recordNative`, never
 * client-input.
 */
export const paymentSchema = z.object({
  amount: z.coerce.number().positive(),
  method: z.enum(["BANK_TRANSFER", "CARD", "CASH", "CHEQUE", "OTHER"]),
  reference: z.string().max(200).optional(),
  paidAt: z.coerce.date(),
  notes: z.string().max(2000).optional(),
});

export type PaymentFormValues = z.input<typeof paymentSchema>;

export const paymentVoidSchema = z.object({
  reason: z.string().min(1).max(1000),
});

export type PaymentVoidValues = z.input<typeof paymentVoidSchema>;
