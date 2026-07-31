/**
 * Zod ↔ Convex validation registry (POLICY.md R-3.1, R-8.6.1).
 *
 * Single source of truth for "these two things describe the same business
 * field set": the client-facing Zod schema (src/lib/validations/*) and the
 * Convex browser-direct arg validator (the `*Fields` object in the matching
 * convex/*Writes.ts module). Originally a test-local table in
 * convex/validationDrift.test.ts; promoted here (design doc §8) so the API
 * dispatcher (src/lib/api/dispatcher.ts) can run the SAME Zod schema the UI
 * hooks run before calling Convex, instead of relying solely on the in-Convex
 * `fieldGuards`/`moneyGuards` backstop.
 *
 * They intentionally differ in OPTIONALITY (client input has defaults/
 * coercion; server args are structural) — see `allowZodOnly`/`allowConvexOnly`
 * on each pair for the reviewed, documented divergences.
 */
import { clientFields } from "../../../convex/clientWrites";
import { clientContactFields } from "../../../convex/clientContactWrites";
import { assignmentFields } from "../../../convex/crewAssignmentsWrites";
import { entryFields } from "../../../convex/crewTimeEntriesWrites";
import { checkRecordFields } from "../../../convex/checkRecords";
import { categoryFields } from "../../../convex/categoriesWrites";
import { checkItemFields } from "../../../convex/checkItemsWrites";
import { bulkFields } from "../../../convex/bulkAssetsWrites";
import { prefFields } from "../../../convex/userNotificationPreferences";
import { modelFields } from "../../../convex/modelWrites";
import { locationFields } from "../../../convex/locationsWrites";
import { supplierFields } from "../../../convex/suppliersWrites";
import { subTestFields } from "../../../convex/subTestRecords";
import { projectWriteFields } from "../../../convex/projects";
import { updateFields as supplierOrderUpdateFields } from "../../../convex/supplierOrdersWrites";
import { itemFields as supplierOrderItemFields } from "../../../convex/supplierOrderItemsWrites";
import {
  quoteSendFields,
  quoteRecallFields,
  quoteAcceptFields,
  quoteDeclineFields,
} from "../../../convex/quotesWrites";
import { invoiceFields, invoiceIssueFields } from "../../../convex/invoicesWrites";
import { paymentFields } from "../../../convex/paymentsWrites";

import { clientSchema } from "./client";
import { clientContactSchema } from "./client-contact";
import { projectSchema } from "./project";
import { crewAssignmentSchema, crewTimeEntrySchema } from "./crew";
import { checkRecordSchema, checkItemSchema } from "./check-item";
import { categorySchema } from "./category";
import { bulkAssetSchema, locationSchema } from "./asset";
import { notificationPreferenceSchema } from "./notification-preferences";
import { modelSchema } from "./model";
import { supplierSchema } from "./supplier";
import { subTestRecordSchema } from "./test-tag";
import { supplierOrderUpdateSchema, supplierOrderItemSchema } from "./supplier-order";
import { quoteSendSchema, quoteRecallSchema, quoteAcceptSchema, quoteDeclineSchema } from "./quote";
import { invoiceSchema, invoiceIssueSchema } from "./invoice";
import { paymentSchema } from "./payment";

/** Unwrap a Zod schema (through .refine/.default/.optional wrappers) to its object shape keys. */
export function zodKeys(schema: unknown): string[] {
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

export interface ValidationPair {
  name: string;
  zod: unknown;
  convex: Record<string, unknown>;
  /** Keys deliberately present on only one side (reviewed). */
  allowZodOnly?: string[];
  allowConvexOnly?: string[];
}

export const VALIDATION_PAIRS: ValidationPair[] = [
  { name: "client", zod: clientSchema, convex: clientFields },
  { name: "clientContact", zod: clientContactSchema, convex: clientContactFields },
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
  {
    name: "model",
    zod: modelSchema,
    convex: modelFields,
    // WS6 #945: maintenanceIntervalDays was removed from the interactive
    // create/edit form's Zod schema (superseded by serviceSchedules) but is
    // deliberately LEFT wired in modelWrites.ts because CSV bulk import/export
    // (src/server/csv.ts) still reads/writes this column via the generic
    // convex/models.ts CRUD — migrating that surface is a separate follow-up.
    // See the deprecation comment on convex/schema.ts's models.maintenanceIntervalDays.
    allowConvexOnly: ["maintenanceIntervalDays"],
  },
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
      // WS1 (#940) — depositPaid/invoicedTotal moved from "hand-typed input" to
      // recalc-owned PROJECT_MONEY_ANCHORS (derived from the project's Invoice
      // rows), same treatment as the anchors just above — never a form field.
      "depositPaid", "invoicedTotal",
      "isTemplate", "createdAt", "updatedAt", "projectManagerId",
    ],
  },
  // WS7 #946 — supplierOrder HEADER EDIT (status/orderDate/expectedDate/notes only;
  // supplierId/orderNumber/type/projectId are create-time-only, not part of this pair).
  { name: "supplierOrderUpdate", zod: supplierOrderUpdateSchema, convex: supplierOrderUpdateFields },
  // WS7 #946 — supplierOrderItem CRUD (new browser path; previously had none).
  { name: "supplierOrderItem", zod: supplierOrderItemSchema, convex: supplierOrderItemFields },
  // WS1 #940 / #986 — the four quote verbs that take client input (new-version
  // takes none) + invoice create (finance model).
  { name: "quoteSend", zod: quoteSendSchema, convex: quoteSendFields },
  { name: "quoteRecall", zod: quoteRecallSchema, convex: quoteRecallFields },
  { name: "quoteAccept", zod: quoteAcceptSchema, convex: quoteAcceptFields },
  { name: "quoteDecline", zod: quoteDeclineSchema, convex: quoteDeclineFields },
  {
    name: "invoice",
    zod: invoiceSchema,
    convex: invoiceFields,
    // dueDate is a Date client-side, a ms-timestamp number over the wire — the
    // hook converts it, same pattern as every other date field in this codebase
    // (see "Date Handling" in FEATUREDOCS/28-patterns.md); field NAME matches.
  },
  // #989 — the invoice ISSUE dialog's fields (distinct from create above).
  { name: "invoiceIssue", zod: invoiceIssueSchema, convex: invoiceIssueFields },
  // #1055 — recording a payment against an ISSUED invoice.
  { name: "payment", zod: paymentSchema, convex: paymentFields },
];

export const VALIDATION_PAIR_BY_NAME: Readonly<Record<string, ValidationPair>> = Object.fromEntries(
  VALIDATION_PAIRS.map((p) => [p.name, p]),
);

/**
 * Maps a dispatcher operation (`"<module>.<fn>"`, matching `RegistryOperation.operation`
 * in src/lib/api/registry.generated.ts) to the validation pair that bounds its
 * business-input fields. Best-effort, NOT exhaustive: an agent-reachable write absent
 * from this map has no client-Zod parity check at the dispatcher layer and relies
 * solely on the in-Convex `fieldGuards`/`moneyGuards` backstop (still enforced —
 * this map only adds an earlier, UI-matching rejection message, per design §8).
 */
export const OPERATION_VALIDATION_PAIR: Readonly<Record<string, string>> = {
  "clientWrites.createNative": "client",
  "clientWrites.updateNative": "client",
  "clientContactWrites.addNative": "clientContact",
  "clientContactWrites.updateNative": "clientContact",
  "crewAssignmentsWrites.createNative": "crewAssignment",
  "crewAssignmentsWrites.updateNative": "crewAssignment",
  "crewTimeEntriesWrites.createNative": "crewTimeEntry",
  "crewTimeEntriesWrites.updateNative": "crewTimeEntry",
  "checkRecords.create": "checkRecord",
  "checkRecords.createManyIfMissing": "checkRecord",
  "categoriesWrites.createNative": "category",
  "categoriesWrites.updateNative": "category",
  "checkItemsWrites.createCheckItemNative": "checkItem",
  "checkItemsWrites.updateCheckItemNative": "checkItem",
  "bulkAssetsWrites.createNative": "bulkAsset",
  "bulkAssetsWrites.updateNative": "bulkAsset",
  "userNotificationPreferences.upsertMine": "notificationPreference",
  "modelWrites.createNative": "model",
  "modelWrites.updateNative": "model",
  "locationsWrites.createNative": "location",
  "locationsWrites.updateNative": "location",
  "suppliersWrites.createNative": "supplier",
  "suppliersWrites.updateNative": "supplier",
  "subTestRecords.create": "subTestRecord",
  "subTestRecords.createManyIfMissing": "subTestRecord",
  "projects.createWithUniqueNumber": "project",
  "projects.patchProject": "project",
  "supplierOrdersWrites.updateNative": "supplierOrderUpdate",
  "supplierOrderItemsWrites.addSupplierOrderItemNative": "supplierOrderItem",
  "supplierOrderItemsWrites.updateSupplierOrderItemNative": "supplierOrderItem",
  "quotesWrites.sendNative": "quoteSend",
  "quotesWrites.recallNative": "quoteRecall",
  "quotesWrites.markAcceptedNative": "quoteAccept",
  "quotesWrites.markDeclinedNative": "quoteDecline",
  "invoicesWrites.createNative": "invoice",
  "paymentsWrites.recordNative": "payment",
};
