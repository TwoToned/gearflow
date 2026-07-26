import { z } from "zod";

export const supplierOrderSchema = z.object({
  supplierId: z.string().min(1, "Supplier is required"),
  orderNumber: z.string().min(1, "Order number is required").max(100),
  type: z.enum(["PURCHASE", "SUBHIRE", "REPAIR", "LABOUR", "OTHER"]),
  status: z.enum(["DRAFT", "ORDERED", "PARTIAL", "RECEIVED", "CANCELLED"]).default("DRAFT"),
  orderDate: z.union([z.literal(""), z.coerce.date()]).optional().transform(v => v === "" ? undefined : v),
  expectedDate: z.union([z.literal(""), z.coerce.date()]).optional().transform(v => v === "" ? undefined : v),
  receivedDate: z.union([z.literal(""), z.coerce.date()]).optional().transform(v => v === "" ? undefined : v),
  projectId: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

export type SupplierOrderFormValues = z.input<typeof supplierOrderSchema>;

// WS7 #946 — the order HEADER EDIT form (order detail page) only ever touches
// status/orderDate/expectedDate/notes (supplierId/orderNumber/type/projectId are
// fixed at creation). Derived via `.pick()` (R-8.6.3) rather than re-declared —
// paired with `convex/supplierOrdersWrites.ts`'s `updateFields` in
// convex/validationDrift.test.ts (R-8.6.1).
export const supplierOrderUpdateSchema = supplierOrderSchema.pick({
  status: true,
  orderDate: true,
  expectedDate: true,
  notes: true,
});

export type SupplierOrderUpdateFormValues = z.input<typeof supplierOrderUpdateSchema>;

export const supplierOrderItemSchema = z.object({
  description: z.string().min(1, "Description is required").max(500),
  quantity: z.coerce.number().int().min(1).default(1),
  unitPrice: z.union([z.literal(""), z.coerce.number().min(0)]).optional().transform(v => v === "" ? undefined : v),
  modelId: z.string().optional(),
  assetId: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

export type SupplierOrderItemFormValues = z.input<typeof supplierOrderItemSchema>;
