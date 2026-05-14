/**
 * Zod schemas for damage capture (Wave 3).
 *
 * MUST live outside `"use server"` files — Next.js bans non-async exports
 * from server modules.
 */

import { z } from "zod";

export const damageSeveritySchema = z.enum(["MINOR", "MAJOR", "TOTAL"]);
export type DamageSeverity = z.infer<typeof damageSeveritySchema>;

export const damageStatusSchema = z.enum([
  "OPEN",
  "UNDER_REPAIR",
  "RESOLVED",
  "CHARGED_BACK",
]);
export type DamageStatus = z.infer<typeof damageStatusSchema>;

/**
 * Create a damage event. Required: severity + at least one of
 * assetId / bulkAssetId / lineItemId (we need to know what got damaged).
 * Notes are required so the workshop has context when the maintenance
 * record is created.
 */
export const damageEventCreateSchema = z
  .object({
    severity: damageSeveritySchema,
    notes: z.string().min(1, "Describe what happened").max(2000),
    photos: z.array(z.string().url()).max(20).default([]),
    estimatedCost: z.number().nonnegative().nullable().optional(),
    actualCost: z.number().nonnegative().nullable().optional(),
    chargedBack: z.boolean().default(false),
    projectId: z.string().nullable().optional(),
    lineItemId: z.string().nullable().optional(),
    assetId: z.string().nullable().optional(),
    bulkAssetId: z.string().nullable().optional(),
    /** If true, also create a MaintenanceRecord linked to the same project
     * so the asset hold/release state machine fires immediately. */
    createMaintenanceRecord: z.boolean().default(true),
  })
  .refine(
    (v) =>
      v.assetId != null || v.bulkAssetId != null || v.lineItemId != null,
    {
      message: "Must reference at least one of: assetId, bulkAssetId, lineItemId.",
      path: ["assetId"],
    },
  );

export type DamageEventCreateInput = z.input<typeof damageEventCreateSchema>;

export const damageEventUpdateSchema = z.object({
  severity: damageSeveritySchema.optional(),
  status: damageStatusSchema.optional(),
  notes: z.string().max(2000).optional(),
  photos: z.array(z.string().url()).max(20).optional(),
  estimatedCost: z.number().nonnegative().nullable().optional(),
  actualCost: z.number().nonnegative().nullable().optional(),
  chargedBack: z.boolean().optional(),
});

export type DamageEventUpdateInput = z.input<typeof damageEventUpdateSchema>;

/** Filters for the /damage list page. */
export const damageListFiltersSchema = z.object({
  status: damageStatusSchema.optional(),
  severity: damageSeveritySchema.optional(),
  projectId: z.string().optional(),
  search: z.string().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
});

export type DamageListFilters = z.input<typeof damageListFiltersSchema>;
