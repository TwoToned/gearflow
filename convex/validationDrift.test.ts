/**
 * Validation drift guard (POLICY.md R-8.6.1 — single source of truth).
 *
 * The client Zod schemas (src/lib/validations/*) and the Convex browser-direct
 * arg validators (the `*Fields` objects in convex/*Writes.ts) describe the SAME
 * business fields at two trust boundaries. They intentionally differ in
 * OPTIONALITY (client input has defaults/coercion; server args are structural),
 * so we don't mechanically derive one from the other — that would silently make
 * optional args required and reject valid writes.
 *
 * What we DO enforce here: the two must carry the SAME FIELD SET. Adding or
 * removing a field on one side without the other is drift — this test fails until
 * they're reconciled, which is the guarantee R-8.6.1 asks for. Per-pair `allow`
 * lists document any deliberate, reviewed divergence.
 */
import { describe, expect, it } from "vitest";

import { clientFields } from "./clientWrites";
import { assignmentFields } from "./crewAssignmentsWrites";
import { entryFields } from "./crewTimeEntriesWrites";
import { checkRecordFields } from "./checkRecords";
import { categoryFields } from "./categoriesWrites";
import { checkItemFields } from "./checkItemsWrites";
import { bulkFields } from "./bulkAssetsWrites";
import { prefFields } from "./userNotificationPreferences";
import { modelFields } from "./modelWrites";
import { locationFields } from "./locationsWrites";
import { supplierFields } from "./suppliersWrites";
import { subTestFields } from "./subTestRecords";
import { projectWriteFields } from "./projects";

import { clientSchema } from "@/lib/validations/client";
import { projectSchema } from "@/lib/validations/project";
import { crewAssignmentSchema, crewTimeEntrySchema } from "@/lib/validations/crew";
import { checkRecordSchema, checkItemSchema } from "@/lib/validations/check-item";
import { categorySchema } from "@/lib/validations/category";
import { bulkAssetSchema, locationSchema } from "@/lib/validations/asset";
import { notificationPreferenceSchema } from "@/lib/validations/notification-preferences";
import { modelSchema } from "@/lib/validations/model";
import { supplierSchema } from "@/lib/validations/supplier";
import { subTestRecordSchema } from "@/lib/validations/test-tag";

/** Unwrap a Zod schema (through .refine/.default/.optional wrappers) to its object shape keys. */
function zodKeys(schema: unknown): string[] {
  type Wrap = { schema?: unknown; innerType?: unknown; in?: unknown };
  type Node = { shape?: Record<string, unknown>; _def?: Wrap; def?: Wrap };
  let cur = schema as Node | null | undefined;
  for (let i = 0; i < 8 && cur; i++) {
    if (cur.shape) return Object.keys(cur.shape);
    const def = cur._def ?? cur.def;
    cur = (def?.schema ?? def?.innerType ?? def?.in ?? null) as Node | null;
  }
  throw new Error("could not resolve object shape from schema");
}

interface Pair {
  name: string;
  zod: unknown;
  convex: Record<string, unknown>;
  /** Keys deliberately present on only one side (reviewed). */
  allowZodOnly?: string[];
  allowConvexOnly?: string[];
}

const PAIRS: Pair[] = [
  { name: "client", zod: clientSchema, convex: clientFields },
  {
    name: "crewAssignment",
    zod: crewAssignmentSchema,
    convex: assignmentFields,
    // `generateShifts` is a client-only form control (asks the server to spawn
    // shifts); it isn't a persisted assignment field.
    allowZodOnly: ["generateShifts"],
  },
  { name: "crewTimeEntry", zod: crewTimeEntrySchema, convex: entryFields },
  {
    name: "checkRecord",
    zod: checkRecordSchema,
    convex: checkRecordFields,
    // The client submits { checkItemId, notes, photos, result, value }; the server
    // record additionally carries identity, the resolved target refs, denormalised
    // snapshots, and audit stamps — all server-managed, never client input.
    allowConvexOnly: [
      "assetId", "bulkAssetId", "checkItemLabelSnapshot", "checkItemTypeSnapshot",
      "context", "id", "kitId", "lineItemId", "lineItemUnitId", "organizationId",
      "performedAt", "performedById",
    ],
  },
  { name: "category", zod: categorySchema, convex: categoryFields },
  { name: "checkItem", zod: checkItemSchema, convex: checkItemFields },
  { name: "bulkAsset", zod: bulkAssetSchema, convex: bulkFields },
  { name: "notificationPreference", zod: notificationPreferenceSchema, convex: prefFields },
  { name: "model", zod: modelSchema, convex: modelFields },
  { name: "location", zod: locationSchema, convex: locationFields },
  { name: "supplier", zod: supplierSchema, convex: supplierFields },
  {
    name: "subTestRecord",
    zod: subTestRecordSchema,
    convex: subTestFields,
    // id + createdAt + the parent FK are server-managed.
    allowConvexOnly: ["createdAt", "id", "testTagRecordId"],
  },
  {
    name: "project",
    zod: projectSchema,
    convex: projectWriteFields,
    // name + projectNumber are top-level createNative args (not part of the shared
    // projectWriteFields spread — projectNumber has its own auto-number/clash-guard
    // handling; name is a required createNative arg, not optional like the rest of
    // projectWriteFields).
    allowZodOnly: ["name", "projectNumber"],
    // Server-managed: the recalc-owned money anchors (never client input, see
    // PROJECT_MONEY_ANCHORS in projectWrites.ts), isTemplate (set at create, never
    // patched in place), audit timestamps, and projectManagerId (managed via the
    // separate projectManagers join table writes, not this field).
    allowConvexOnly: [
      "equipmentRevenue", "serviceCostTotal", "labourCostTotal", "subHireCostTotal",
      "margin", "subtotal", "discountAmount", "taxAmount", "total",
      "isTemplate", "createdAt", "updatedAt", "projectManagerId",
    ],
  },
];

describe("validation field-set parity (Zod client ↔ Convex server) — R-8.6.1", () => {
  it.each(PAIRS)("$name: Convex validator and Zod schema share one field set", (pair) => {
    const zod = new Set(zodKeys(pair.zod));
    const convex = new Set(Object.keys(pair.convex));
    (pair.allowZodOnly ?? []).forEach((k) => zod.delete(k));
    (pair.allowConvexOnly ?? []).forEach((k) => convex.delete(k));

    const zodOnly = [...zod].filter((k) => !convex.has(k)).sort();
    const convexOnly = [...convex].filter((k) => !zod.has(k)).sort();

    expect(
      { zodOnly, convexOnly },
      `Drift in "${pair.name}": these fields exist on only one side. Reconcile the ` +
        `Zod schema (src/lib/validations) and the Convex *Fields validator, or add a ` +
        `documented allow entry in validationDrift.test.ts.`,
    ).toEqual({ zodOnly: [], convexOnly: [] });
  });
});
