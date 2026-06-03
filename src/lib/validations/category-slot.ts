import { z } from "zod";

/**
 * Validation schemas for the cross-type CategorySlot server actions.
 *
 * Slot IDs in the unified group list are prefixed so a single ordering call
 * can address both kinds of group with one array:
 *   - `pg-<projectGroupId>`   → ProjectGroup
 *   - `shg-<subHireGroupId>`  → SubHireGroup
 *
 * The reorder action validates the prefix and rejects bare IDs early so a
 * malformed client payload can't accidentally update the wrong table.
 */

export const SLOT_ID_PREFIX = {
  projectGroup: "pg-",
  subHireGroup: "shg-",
} as const;

const slotIdSchema = z
  .string()
  .min(SLOT_ID_PREFIX.projectGroup.length + 1)
  .refine(
    (id) =>
      id.startsWith(SLOT_ID_PREFIX.projectGroup) ||
      id.startsWith(SLOT_ID_PREFIX.subHireGroup),
    { message: "Slot ID must be prefixed with 'pg-' or 'shg-'" }
  );

export const moveSubHireGroupToCategorySchema = z.object({
  groupId: z.string().min(1),
  /** null = move to uncategorised */
  categoryId: z.string().min(1).nullable(),
});
export type MoveSubHireGroupToCategoryInput = z.input<typeof moveSubHireGroupToCategorySchema>;

export const reorderMixedGroupsInCategorySchema = z.object({
  categoryId: z.string().min(1),
  orderedIds: z.array(slotIdSchema).min(1),
});
export type ReorderMixedGroupsInCategoryInput = z.input<typeof reorderMixedGroupsInCategorySchema>;

export const createCategoryAndPlaceGroupSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1, "Name is required").max(100),
  /** Which group to drop into the new category. Exactly one of the IDs must
   *  be set — Zod's discriminated union doesn't help here because both
   *  branches share the same shape, so we enforce XOR via `.superRefine`. */
  slot: z
    .object({
      projectGroupId: z.string().min(1).nullable().optional(),
      subHireGroupId: z.string().min(1).nullable().optional(),
    })
    .superRefine((val, ctx) => {
      const hasPg = !!val.projectGroupId;
      const hasShg = !!val.subHireGroupId;
      if (hasPg === hasShg) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "slot must reference exactly one of projectGroupId or subHireGroupId",
        });
      }
    }),
});
export type CreateCategoryAndPlaceGroupInput = z.input<typeof createCategoryAndPlaceGroupSchema>;

/**
 * Split a prefixed slot ID into its kind + bare ID. Returns null if the
 * prefix isn't recognised — callers should treat that as a programmer
 * error (Zod has already rejected such IDs at the action boundary).
 */
export function parseSlotId(
  id: string
): { kind: "projectGroup"; id: string } | { kind: "subHireGroup"; id: string } | null {
  if (id.startsWith(SLOT_ID_PREFIX.projectGroup)) {
    return { kind: "projectGroup", id: id.slice(SLOT_ID_PREFIX.projectGroup.length) };
  }
  if (id.startsWith(SLOT_ID_PREFIX.subHireGroup)) {
    return { kind: "subHireGroup", id: id.slice(SLOT_ID_PREFIX.subHireGroup.length) };
  }
  return null;
}
