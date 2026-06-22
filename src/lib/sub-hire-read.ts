import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import type {
  SubHireStatus,
  SubHirePricingMode,
  SubHirePaymentStatus,
  PricingType,
} from "@/generated/prisma/client";

/**
 * Server-side read helpers for the sub-hire domain (Phase C read-rewiring of the
 * Convex domain-only decommission). `subHire` + `subHireItem` + `subHireGroup` are
 * dual-written (see src/lib/sub-hire-mirror.ts). These helpers read the Convex copy
 * and shape it back into the Prisma-row form the sub-hire pages expect (epoch-ms →
 * Date, Decimal → number, absent optionals → null).
 *
 * Cross-domain joins are composed by the caller: supplier via suppliers-read, model
 * via models-read, project via projects-read, the target category/group labels via
 * the project-grouping reads, `createdBy` (Better Auth User) via Prisma (auth stays
 * Prisma forever), and the linked project line items via project-line-item-read.
 *
 * `subHireMedia` is read separately (media-read); it is already Convex-only.
 */

type RawSubHire = Doc<"subHires">;
type RawItem = Doc<"subHireItems">;
type RawGroup = Doc<"subHireGroups">;

const toDate = (v: number | undefined): Date | null => (typeof v === "number" ? new Date(v) : null);
const orNull = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
const req = <T>(v: T | undefined): T => v as T;

export interface SubHireRow {
  id: string;
  organizationId: string;
  supplierId: string;
  projectId: string | null;
  createdById: string;
  orderNumber: string;
  supplierReference: string | null;
  status: SubHireStatus;
  hireStart: Date | null;
  hireEnd: Date | null;
  totalCost: number;
  totalCharge: number;
  pricingMode: SubHirePricingMode;
  orderTotalCost: number | null;
  orderTotalCharge: number | null;
  showOnDocs: boolean;
  paymentStatus: SubHirePaymentStatus;
  notes: string | null;
  defaultTargetCategoryId: string | null;
  defaultTargetGroupId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface SubHireItemRow {
  id: string;
  subHireId: string;
  groupId: string | null;
  modelId: string | null;
  description: string;
  quantity: number;
  unitCost: number;
  unitCharge: number;
  pricingType: PricingType;
  duration: number;
  discount: number;
  showOnQuote: boolean;
  showOnDocs: boolean;
  sortOrder: number;
  targetCategoryId: string | null;
  targetGroupId: string | null;
}

export interface SubHireGroupRow {
  id: string;
  subHireId: string;
  title: string;
  sortOrder: number;
  quantity: number;
  cost: number | null;
  charge: number | null;
  showOnQuote: boolean;
  showOnDocs: boolean;
  targetCategoryId: string | null;
  targetGroupId: string | null;
}

export function mapSubHire(d: RawSubHire): SubHireRow {
  return {
    id: d.id,
    organizationId: req(d.organizationId),
    supplierId: req(d.supplierId),
    projectId: orNull(d.projectId),
    createdById: req(d.createdById),
    orderNumber: req(d.orderNumber),
    supplierReference: orNull(d.supplierReference),
    status: (d.status ?? "DRAFT") as SubHireStatus,
    hireStart: toDate(d.hireStart),
    hireEnd: toDate(d.hireEnd),
    totalCost: d.totalCost ?? 0,
    totalCharge: d.totalCharge ?? 0,
    pricingMode: (d.pricingMode ?? "ITEMIZED") as SubHirePricingMode,
    orderTotalCost: orNull(d.orderTotalCost),
    orderTotalCharge: orNull(d.orderTotalCharge),
    showOnDocs: d.showOnDocs ?? false,
    paymentStatus: (d.paymentStatus ?? "UNPAID") as SubHirePaymentStatus,
    notes: orNull(d.notes),
    defaultTargetCategoryId: orNull(d.defaultTargetCategoryId),
    defaultTargetGroupId: orNull(d.defaultTargetGroupId),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

export function mapSubHireItem(d: RawItem): SubHireItemRow {
  return {
    id: d.id,
    subHireId: req(d.subHireId),
    groupId: orNull(d.groupId),
    modelId: orNull(d.modelId),
    description: req(d.description),
    quantity: d.quantity ?? 1,
    unitCost: d.unitCost ?? 0,
    unitCharge: d.unitCharge ?? 0,
    pricingType: (d.pricingType ?? "FLAT") as PricingType,
    duration: d.duration ?? 1,
    discount: d.discount ?? 0,
    showOnQuote: d.showOnQuote ?? true,
    showOnDocs: d.showOnDocs ?? false,
    sortOrder: d.sortOrder ?? 0,
    targetCategoryId: orNull(d.targetCategoryId),
    targetGroupId: orNull(d.targetGroupId),
  };
}

export function mapSubHireGroup(d: RawGroup): SubHireGroupRow {
  return {
    id: d.id,
    subHireId: req(d.subHireId),
    title: req(d.title),
    sortOrder: d.sortOrder ?? 0,
    quantity: d.quantity ?? 1,
    cost: orNull(d.cost),
    charge: orNull(d.charge),
    showOnQuote: d.showOnQuote ?? true,
    showOnDocs: d.showOnDocs ?? false,
    targetCategoryId: orNull(d.targetCategoryId),
    targetGroupId: orNull(d.targetGroupId),
  };
}

// ─── Heads ─────────────────────────────────────────────────────────────────────

export async function getSubHiresByOrg(orgId: string): Promise<SubHireRow[]> {
  const rows = (await (await getConvexClient()).query(api.subHires.list, { orgId })) as RawSubHire[];
  return rows.map(mapSubHire);
}

export async function getSubHireById(id: string): Promise<SubHireRow | null> {
  const row = (await (await getConvexClient()).query(api.subHires.getById, { id })) as RawSubHire | null;
  return row ? mapSubHire(row) : null;
}

export async function getSubHiresByProject(projectId: string, orgId: string): Promise<SubHireRow[]> {
  const rows = (await (await getConvexClient()).query(api.subHires.listByProject, {
    projectId,
    orgId,
  })) as RawSubHire[];
  return rows.map(mapSubHire);
}

// ─── Items / groups ──────────────────────────────────────────────────────────────

/** Items for one sub-hire, sorted by sortOrder asc. */
export async function getSubHireItems(subHireId: string): Promise<SubHireItemRow[]> {
  const rows = (await (await getConvexClient()).query(api.subHireItems.list, { subHireId })) as RawItem[];
  return rows.map(mapSubHireItem).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Groups for one sub-hire, sorted by sortOrder asc. */
export async function getSubHireGroups(subHireId: string): Promise<SubHireGroupRow[]> {
  const rows = (await (await getConvexClient()).query(api.subHireGroups.list, { subHireId })) as RawGroup[];
  return rows.map(mapSubHireGroup).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Item counts per sub-hire id (one round trip each) for the list `_count`. */
export async function getSubHireItemCounts(subHireIds: string[]): Promise<Map<string, number>> {
  if (subHireIds.length === 0) return new Map();
  const client = await getConvexClient();
  const counts = new Map<string, number>();
  await Promise.all(
    subHireIds.map(async (id) => {
      const rows = (await client.query(api.subHireItems.list, { subHireId: id })) as RawItem[];
      counts.set(id, rows.length);
    }),
  );
  return counts;
}
