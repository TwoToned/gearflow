/**
 * Phase 3 (#1080/#1093) — the ONE mapper that turns a `SnapshotEntryLike[]`
 * (the shape both `projectLocksRead.snapshotEntries` — a frozen version — and
 * `projectLocksRead.currentEntries` — the live state, same shape — return)
 * into the DTOs the version switcher's read-only projection renders. Framework-
 * free/pure on purpose: it's the ONE mapper serving both the snapshot path and
 * the live path (R-3.1) — never a parallel hand-written shape per source, and
 * it must be safe to unit-test and to run inside a Convex `convex-test`
 * environment for the projection-parity test (no React import).
 *
 * What it CANNOT produce — live availability, live warehouse status, sub-hire
 * lines and category-slot ordering (none of those entity types are captured
 * by `captureProjectSnapshot`, see convex/lib/projectSnapshots.ts) — is
 * reported via `uncaptured` rather than a plausible-looking zero (design doc
 * §5.1: "a wrong number that looks right is worse than an absent one").
 */

type SnapshotEntityType = "project" | "category" | "group" | "lineItem" | "service" | "crewAssignment";

export interface SnapshotEntryLike {
  entityType: SnapshotEntityType;
  entityId: string;
  data: Record<string, unknown>;
}

export interface ProjectedLineItem {
  id: string;
  categoryId: string | null;
  groupId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  discountMode: "$" | "%";
  lineTotal: number | null;
  type: string | null;
  isKitChild: boolean;
  isOptional: boolean;
  sortOrder: number;
}

export interface ProjectedGroup {
  id: string;
  categoryId: string | null;
  title: string;
  price: number | null;
  discount: number | null;
  discountMode: "$" | "%";
  quantity: number | null;
  sortOrder: number;
  lineItems: ProjectedLineItem[];
}

export interface ProjectedCategory {
  id: string;
  name: string;
  sortOrder: number;
  groups: ProjectedGroup[];
  ungroupedLineItems: ProjectedLineItem[];
}

interface ProjectedEquipmentView {
  categories: ProjectedCategory[];
  uncategorizedGroups: ProjectedGroup[];
  uncategorizedLineItems: ProjectedLineItem[];
}

interface ProjectedService {
  id: string;
  type: string;
  title: string;
  description: string | null;
  date: number | null;
  unitPrice: number | null;
  quantity: number | null;
  discount: number | null;
  lineTotal: number | null;
  costTotal: number | null;
  sortOrder: number;
}

interface ProjectedCrewAssignment {
  id: string;
  crewMemberId: string;
  crewRoleId: string | null;
  serviceId: string | null;
  rateOverride: number | null;
  rateType: string | null;
  estimatedHours: number | null;
  estimatedCost: number | null;
  isProjectManager: boolean;
}

interface ProjectedFinance {
  name: string | null;
  clientId: string | null;
  locationId: string | null;
  rentalStartDate: string | null;
  rentalEndDate: string | null;
  subtotal: number | null;
  total: number | null;
  taxAmount: number | null;
  taxRate: number | null;
  discountPercent: number | null;
  discountAmount: number | null;
  margin: number | null;
  equipmentRevenue: number | null;
  serviceCostTotal: number | null;
  labourCostTotal: number | null;
  subHireCostTotal: number | null;
}

/** The project row's own free-text fields — captured because the WHOLE
 *  project row is snapshotted (design doc §4.2: "Tasks aren't versioned" does
 *  NOT apply to these — they're project fields, not the separate comment-
 *  thread/task tables). */
interface ProjectedNotes {
  crewNotes: string | null;
  internalNotes: string | null;
  clientNotes: string | null;
}

/** Entity types/facets the snapshot format never captures — always the same
 *  set (it's a property of `captureProjectSnapshot`'s shape, not of any one
 *  project), listed once here so every consumer renders the identical
 *  "not captured" explanation instead of independently guessing at one.
 *  Not exported — read it off `ProjectedView.uncaptured` instead of the
 *  constant directly, so every consumer goes through the one value the
 *  mapper actually attached (R-3.1). */
const UNCAPTURED_FACETS = [
  "subHires",
  "categorySlotOrder",
  "liveAvailability",
  "warehouseStatus",
] as const;

export interface ProjectedView {
  equipment: ProjectedEquipmentView;
  services: ProjectedService[];
  crew: ProjectedCrewAssignment[];
  finance: ProjectedFinance;
  notes: ProjectedNotes;
  uncaptured: readonly string[];
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function bool(v: unknown): boolean {
  return v === true;
}
function discountModeOf(v: unknown): "$" | "%" {
  return v === "%" ? "%" : "$";
}

function mapLineItem(e: SnapshotEntryLike): ProjectedLineItem {
  const d = e.data;
  return {
    id: e.entityId,
    categoryId: str(d.categoryId),
    groupId: str(d.groupId),
    description: str(d.description) ?? "",
    quantity: num(d.quantity) ?? 0,
    unitPrice: num(d.unitPrice) ?? 0,
    discount: num(d.discount) ?? 0,
    discountMode: discountModeOf(d.discountMode),
    lineTotal: num(d.lineTotal),
    type: str(d.type),
    isKitChild: bool(d.isKitChild),
    isOptional: bool(d.isOptional),
    sortOrder: num(d.sortOrder) ?? 0,
  };
}

function mapService(e: SnapshotEntryLike): ProjectedService {
  const d = e.data;
  return {
    id: e.entityId,
    type: str(d.type) ?? "OTHER",
    title: str(d.title) ?? "",
    description: str(d.description),
    date: num(d.date),
    unitPrice: num(d.unitPrice),
    quantity: num(d.quantity),
    discount: num(d.discount),
    lineTotal: num(d.lineTotal),
    costTotal: num(d.costTotal),
    sortOrder: num(d.sortOrder) ?? 0,
  };
}

function mapCrew(e: SnapshotEntryLike): ProjectedCrewAssignment {
  const d = e.data;
  return {
    id: e.entityId,
    crewMemberId: str(d.crewMemberId) ?? "",
    crewRoleId: str(d.crewRoleId),
    serviceId: str(d.serviceId),
    rateOverride: num(d.rateOverride),
    rateType: str(d.rateType),
    estimatedHours: num(d.estimatedHours),
    estimatedCost: num(d.estimatedCost),
    isProjectManager: bool(d.isProjectManager),
  };
}

/** Maps a snapshot's (or the live state's, via `currentEntries` — identical
 *  shape) entries into every tab's projected DTOs in one pass. Pure/sync —
 *  safe to call from a React render, a Convex query handler, or a test. */
export function projectSnapshotEntries(entries: SnapshotEntryLike[]): ProjectedView {
  const projectEntry = entries.find((e) => e.entityType === "project");
  const project = projectEntry?.data ?? {};
  const categoryEntries = entries.filter((e) => e.entityType === "category");
  const groupEntries = entries.filter((e) => e.entityType === "group");
  const lineItemEntries = entries.filter((e) => e.entityType === "lineItem");
  const serviceEntries = entries.filter((e) => e.entityType === "service");
  const crewEntries = entries.filter((e) => e.entityType === "crewAssignment");

  const groups: ProjectedGroup[] = groupEntries
    .map((e) => {
      const d = e.data;
      const lineItems = lineItemEntries
        .filter((li) => str(li.data.groupId) === e.entityId)
        .map(mapLineItem)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      return {
        id: e.entityId,
        categoryId: str(d.categoryId),
        title: str(d.title) ?? "",
        price: num(d.price),
        discount: num(d.discount),
        discountMode: discountModeOf(d.discountMode),
        quantity: num(d.quantity),
        sortOrder: num(d.sortOrder) ?? 0,
        lineItems,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const groupedLineItemIds = new Set(groups.flatMap((g) => g.lineItems.map((li) => li.id)));
  const standaloneLineItems = lineItemEntries
    .filter((li) => !groupedLineItemIds.has(li.entityId))
    .map(mapLineItem)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const categoryIds = new Set(categoryEntries.map((c) => c.entityId));
  const categories: ProjectedCategory[] = categoryEntries
    .map((e) => {
      const d = e.data;
      return {
        id: e.entityId,
        name: str(d.name) ?? "",
        sortOrder: num(d.sortOrder) ?? 0,
        groups: groups.filter((g) => g.categoryId === e.entityId),
        ungroupedLineItems: standaloneLineItems.filter((li) => li.categoryId === e.entityId),
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    equipment: {
      categories,
      uncategorizedGroups: groups.filter((g) => !g.categoryId || !categoryIds.has(g.categoryId)),
      uncategorizedLineItems: standaloneLineItems.filter((li) => !li.categoryId || !categoryIds.has(li.categoryId)),
    },
    services: serviceEntries.map(mapService).sort((a, b) => a.sortOrder - b.sortOrder),
    crew: crewEntries.map(mapCrew),
    finance: {
      name: str(project.name),
      clientId: str(project.clientId),
      locationId: str(project.locationId),
      rentalStartDate: str(project.rentalStartDate),
      rentalEndDate: str(project.rentalEndDate),
      subtotal: num(project.subtotal),
      total: num(project.total),
      taxAmount: num(project.taxAmount),
      taxRate: num(project.taxRate),
      discountPercent: num(project.discountPercent),
      discountAmount: num(project.discountAmount),
      margin: num(project.margin),
      equipmentRevenue: num(project.equipmentRevenue),
      serviceCostTotal: num(project.serviceCostTotal),
      labourCostTotal: num(project.labourCostTotal),
      subHireCostTotal: num(project.subHireCostTotal),
    },
    notes: {
      crewNotes: str(project.crewNotes),
      internalNotes: str(project.internalNotes),
      clientNotes: str(project.clientNotes),
    },
    uncaptured: UNCAPTURED_FACETS,
  };
}
