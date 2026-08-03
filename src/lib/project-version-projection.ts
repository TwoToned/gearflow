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
 * What it CANNOT produce — live availability and live warehouse status, the
 * two genuinely point-in-time facts no snapshot can ever freeze — is reported
 * via `uncaptured` rather than a plausible-looking zero (design doc §5.1: "a
 * wrong number that looks right is worse than an absent one"). Sub-hires and
 * category-slot ordering used to be on this list too; #1080/#1101 widened
 * `captureProjectSnapshot` to capture both, so equipment parity with the live
 * table now goes through a separate bundle-assembly query +
 * `equipment-tab-reconstruct.ts` rather than this pure mapper — see
 * FEATUREDOCS/70's "Phase 6" and `convex/projectVersionsEquipment.ts`.
 */

/** #1080/#1101 widened this to add `subHire`/`subHireItem`/`subHireGroup`/
 *  `categorySlot` (kept in lockstep with `convex/lib/projectSnapshots.ts`'s
 *  `SnapshotEntityType`, R-3.1) — this mapper doesn't map them itself (they
 *  flow through the new bundle-assembly query + `equipment-tab-reconstruct.ts`
 *  instead, see FEATUREDOCS/70's "Phase 6"), it just needs to type-accept
 *  entries that carry them without narrowing incorrectly. */
type SnapshotEntityType =
  | "project"
  | "category"
  | "group"
  | "lineItem"
  | "service"
  | "crewAssignment"
  | "subHire"
  | "subHireItem"
  | "subHireGroup"
  | "categorySlot";

export interface SnapshotEntryLike {
  entityType: SnapshotEntityType;
  entityId: string;
  data: Record<string, unknown>;
}

/** #1080/#1101 — no longer exported: equipment parity now goes through the
 *  bundle-assembly query (`convex/projectVersionsEquipment.ts`) instead of
 *  this pure mapper's `equipment` field, so these three types have no
 *  consumer outside this file anymore (only `ProjectedEquipmentView`, kept
 *  for the projection-parity test's snapshot-vs-live equality check). */
interface ProjectedLineItem {
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

interface ProjectedGroup {
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

interface ProjectedCategory {
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
  // WS11 (#950) — standalone SALE lines' revenue/COGS, excluded from
  // equipmentRevenue (convex/lib/recalc.ts).
  saleRevenue: number | null;
  saleCostTotal: number | null;
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

/** Facets that stay permanently uncapturable — genuinely LIVE, point-in-time
 *  facts, not business decisions a version can freeze (a past revision cannot
 *  recompute today's warehouse conflicts or which physical serial is
 *  currently checked out). `subHires`/`categorySlotOrder` were on this list
 *  before #1080/#1101 — `captureProjectSnapshot` now captures both, so a
 *  snapshot taken from this point on carries them (an OLDER snapshot simply
 *  has no entries of those types, which the equipment bundle-assembly query
 *  degrades from gracefully, not an error). Not exported — read it off
 *  `ProjectedView.uncaptured` instead of the constant directly (R-3.1). */
const UNCAPTURED_FACETS = ["liveAvailability", "warehouseStatus"] as const;

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
      saleRevenue: num(project.saleRevenue),
      saleCostTotal: num(project.saleCostTotal),
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
