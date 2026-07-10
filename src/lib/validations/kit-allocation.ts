import { z } from "zod";

/**
 * Kit revenue allocation (docs/revenue-allocation-design.md).
 *
 * The 100% rule is a UI affordance, not a correctness guarantee — a kit's contents
 * change from the warehouse and CSV import without ever passing through this form,
 * so the allocation engine independently re-checks that a saved split still covers
 * the kit before applying it. Blocking here just stops us saving a split we already
 * know is wrong.
 */

export const kitAllocationRowSchema = z.object({
  modelId: z.string().min(1),
  allocationPercent: z
    .number()
    .min(0, "Can't be negative")
    .max(100, "Can't exceed 100%")
    // Two decimals is what the column stores. Accepting more would silently round
    // on write and break the sum-to-100 check the user just watched pass.
    //
    // Compare against an epsilon, not `Number.isInteger(Math.round(...))` — Math.round
    // ALWAYS returns an integer, so that predicate is unconditionally true and the
    // guard never fires. The epsilon absorbs float representation error: 33.33 * 100
    // is 3332.9999999999995, which is two decimals despite not being an exact integer.
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-9, {
      message: "At most 2 decimal places",
    }),
});

export const kitAllocationSchema = z
  .object({
    kitId: z.string().min(1),
    rows: z.array(kitAllocationRowSchema),
  })
  .refine(
    (v) => new Set(v.rows.map((r) => r.modelId)).size === v.rows.length,
    { message: "Each model may appear once", path: ["rows"] },
  )
  .refine(
    (v) => {
      if (v.rows.length === 0) return true; // clearing the allocation
      const sum = v.rows.reduce((s, r) => s + r.allocationPercent, 0);
      return Math.abs(sum - 100) <= 0.01;
    },
    { message: "Allocation must total 100%", path: ["rows"] },
  );

export type KitAllocationRow = z.input<typeof kitAllocationRowSchema>;
export type KitAllocationFormValues = z.input<typeof kitAllocationSchema>;

/** Shape returned by `convex/kitAllocations.getKitAllocation`. */
export interface KitAllocationView {
  kitId: string;
  kitName: string;
  rows: {
    modelId: string;
    modelName: string;
    replacementCost: number | null;
    quantity: number;
    allocationPercent: number | null;
    suggestedPercent: number;
  }[];
  hasAllocation: boolean;
  isStale: boolean;
  orphanedModelIds: string[];
}
