/**
 * Zod schemas for operator-defined custom fields (Wave 3).
 *
 * MUST live outside `"use server"` files.
 */

import { z } from "zod";

export const customFieldEntitySchema = z.enum([
  "ASSET",
  "BULK_ASSET",
  "KIT",
  "PROJECT",
]);
export type CustomFieldEntity = z.infer<typeof customFieldEntitySchema>;

export const customFieldTypeSchema = z.enum([
  "TEXT",
  "NUMBER",
  "DATE",
  "SELECT",
  "BOOLEAN",
]);
export type CustomFieldType = z.infer<typeof customFieldTypeSchema>;

/** A fieldKey must be a stable, JSON-safe identifier. */
const fieldKeyRegex = /^[a-zA-Z][a-zA-Z0-9_]*$/;

export const customFieldDefinitionSchema = z
  .object({
    entityType: customFieldEntitySchema.default("ASSET"),
    label: z.string().min(1, "Label is required").max(60),
    fieldKey: z
      .string()
      .min(1, "Key is required")
      .max(40)
      .regex(fieldKeyRegex, "Key must start with a letter; letters, numbers, underscores only"),
    fieldType: customFieldTypeSchema.default("TEXT"),
    options: z.array(z.string().min(1).max(80)).max(50).default([]),
    required: z.boolean().default(false),
    helpText: z.string().max(200).optional(),
    sortOrder: z.number().int().min(0).default(0),
    isActive: z.boolean().default(true),
  })
  .refine(
    (v) => v.fieldType !== "SELECT" || v.options.length > 0,
    { message: "SELECT fields need at least one option", path: ["options"] },
  );

export type CustomFieldDefinitionInput = z.input<typeof customFieldDefinitionSchema>;

/** Update form — fieldKey + entityType are immutable once created. */
export const customFieldDefinitionUpdateSchema = z
  .object({
    label: z.string().min(1).max(60),
    fieldType: customFieldTypeSchema,
    options: z.array(z.string().min(1).max(80)).max(50).default([]),
    required: z.boolean().default(false),
    helpText: z.string().max(200).optional(),
    sortOrder: z.number().int().min(0).default(0),
    isActive: z.boolean().default(true),
  })
  .refine(
    (v) => v.fieldType !== "SELECT" || v.options.length > 0,
    { message: "SELECT fields need at least one option", path: ["options"] },
  );

export type CustomFieldDefinitionUpdateInput = z.input<
  typeof customFieldDefinitionUpdateSchema
>;

/**
 * Validate a values map against a set of definitions. Returns a normalised
 * record (only known keys, coerced types) or throws on a required-field
 * miss. Used server-side before persisting customFieldValues.
 */
export interface CustomFieldDef {
  fieldKey: string;
  label: string;
  fieldType: CustomFieldType;
  options: string[];
  required: boolean;
}

export function validateCustomFieldValues(
  defs: CustomFieldDef[],
  raw: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const input = raw ?? {};
  const out: Record<string, string> = {};

  for (const def of defs) {
    const value = input[def.fieldKey];
    const isEmpty = value == null || value === "";

    if (isEmpty) {
      if (def.required) {
        throw new Error(`"${def.label}" is required`);
      }
      continue;
    }

    const str = String(value);
    if (def.fieldType === "NUMBER" && Number.isNaN(Number(str))) {
      throw new Error(`"${def.label}" must be a number`);
    }
    if (def.fieldType === "SELECT" && !def.options.includes(str)) {
      throw new Error(`"${def.label}" must be one of: ${def.options.join(", ")}`);
    }
    if (def.fieldType === "BOOLEAN" && str !== "true" && str !== "false") {
      throw new Error(`"${def.label}" must be true or false`);
    }
    out[def.fieldKey] = str;
  }

  return out;
}
