/**
 * CLIENT-SAFE reconstruction of the full getProject shape (Phase 1d, Stage B.2).
 *
 * Combines the three native composites the project-detail page needs —
 * `projectDetail.bundle` (project + managers + media + location + client),
 * `projectEquipment.browserBundle` (the equipment tree, via
 * project-equipment-reconstruct), and (later) `overbooking.bundle` — into the
 * exact object the `getProject` server action returns, so `useProjectDetail` can
 * subscribe natively. ZERO server imports: the runtime mappers below are COPIES of
 * the pure ones in projects-read / locations-read / media-read (which keep
 * server-only co-residents); the TYPES come via `import type` (erased). Parity
 * with the server path is by-copy — keep these in sync if the source mappers change.
 *
 * Overbooked-flag enrichment (`isOverbooked` / `overbookedInfo` on the top-level
 * line items + one level of children) is applied by
 * {@link enrichProjectDetailOverbooked} from the `overbooking.bundle` payload,
 * mirroring `getProject` (which passes the SAME nested top-level array to
 * `computeOverbookedStatus`, so kit children nested under `childLineItems` are not
 * flat-iterated — parity-by-construction).
 */
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import type { ProjectRow } from "@/lib/projects-read";
import type { MappedLocation } from "@/lib/locations-read";
import type { ProjectGalleryMedia, GalleryFile } from "@/lib/media-read";
import {
  reconstructProjectEquipmentTree,
  type EquipmentBundleData,
  type ProjectEquipmentTree,
} from "@/lib/project-equipment-reconstruct";
import {
  reconstructOverbookedStatus,
  type OverbookedInfo,
  type OverbookingBundleData,
} from "@/lib/overbooking-core";

type ProjectDetailBundle = NonNullable<FunctionReturnType<typeof api.projectDetail.bundle>>;
type ProjectDoc = ProjectDetailBundle["project"];
type ManagerRow = ProjectDetailBundle["projectManagers"][number];
type UserDoc = ProjectDetailBundle["managerUsers"][number];
type MediaRow = ProjectDetailBundle["media"][number];
type FileDoc = ProjectDetailBundle["mediaFiles"][number];
type LocationDoc = NonNullable<ProjectDetailBundle["location"]>;

// ─── Pure helpers (copied from the source mappers) ──────────────────────────

const toDate = (v: number | undefined | null): Date | null =>
  typeof v === "number" ? new Date(v) : null;
const orNull = <T>(v: T | undefined | null): T | null => (v == null ? null : v);

/** Copy of projects-read.mapProject: Convex project doc → Prisma row shape.
 *  Exported for reuse by other native reconstructions (e.g. warehouse). */
export function mapProject(d: ProjectDoc): ProjectRow {
  return {
    id: d.id,
    organizationId: d.organizationId,
    projectNumber: d.projectNumber,
    name: d.name,
    clientId: orNull(d.clientId),
    clientContactId: orNull(d.clientContactId),
    status: (d.status ?? "ENQUIRY") as ProjectRow["status"],
    type: (d.type ?? "OTHER") as ProjectRow["type"],
    description: orNull(d.description),
    locationId: orNull(d.locationId),
    siteContactName: orNull(d.siteContactName),
    siteContactPhone: orNull(d.siteContactPhone),
    siteContactEmail: orNull(d.siteContactEmail),
    loadInDate: toDate(d.loadInDate),
    loadInTime: orNull(d.loadInTime),
    eventStartDate: toDate(d.eventStartDate),
    eventStartTime: orNull(d.eventStartTime),
    eventEndDate: toDate(d.eventEndDate),
    eventEndTime: orNull(d.eventEndTime),
    loadOutDate: toDate(d.loadOutDate),
    loadOutTime: orNull(d.loadOutTime),
    projectStartDate: toDate(d.projectStartDate),
    projectStartTime: orNull(d.projectStartTime),
    projectEndDate: toDate(d.projectEndDate),
    projectEndTime: orNull(d.projectEndTime),
    rentalStartDate: toDate(d.rentalStartDate),
    rentalEndDate: toDate(d.rentalEndDate),
    projectManagerId: orNull(d.projectManagerId),
    billingWeeksOverride: orNull(d.billingWeeksOverride),
    billingDaysOverride: orNull(d.billingDaysOverride),
    taxRate: orNull(d.taxRate),
    equipmentRevenue: orNull(d.equipmentRevenue),
    saleRevenue: orNull(d.saleRevenue),
    saleCostTotal: orNull(d.saleCostTotal),
    serviceCostTotal: orNull(d.serviceCostTotal),
    labourCostTotal: orNull(d.labourCostTotal),
    subHireCostTotal: orNull(d.subHireCostTotal),
    margin: orNull(d.margin),
    crewNotes: orNull(d.crewNotes),
    internalNotes: orNull(d.internalNotes),
    clientNotes: orNull(d.clientNotes),
    subtotal: orNull(d.subtotal),
    discountPercent: orNull(d.discountPercent),
    discountAmount: orNull(d.discountAmount),
    taxAmount: orNull(d.taxAmount),
    total: orNull(d.total),
    // WS1 (#940) — depositPercent moved off the project (client payment profile
    // now owns it); depositPaid/invoicedTotal stay here as recalc-derived reads.
    depositPaid: orNull(d.depositPaid),
    invoicedTotal: orNull(d.invoicedTotal),
    tags: d.tags ?? [],
    isTemplate: d.isTemplate ?? false,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
}

/** Copy of locations-read.mapLocation. */
function mapLocation(doc: LocationDoc): MappedLocation {
  return {
    id: doc.id,
    organizationId: doc.organizationId,
    name: doc.name,
    address: doc.address ?? null,
    latitude: doc.latitude ?? null,
    longitude: doc.longitude ?? null,
    type: (doc.type ?? "WAREHOUSE") as MappedLocation["type"],
    isDefault: doc.isDefault ?? false,
    parentId: doc.parentId ?? null,
    notes: doc.notes ?? null,
    tags: doc.tags ?? [],
    createdAt: new Date(doc.createdAt ?? 0),
    updatedAt: new Date(doc.updatedAt ?? 0),
  };
}

/** Copy of media-read.mapGalleryFile. */
function mapGalleryFile(doc: FileDoc | null | undefined): GalleryFile | null {
  if (!doc) return null;
  return {
    id: doc.id,
    organizationId: doc.organizationId,
    fileName: doc.fileName,
    fileSize: doc.fileSize,
    mimeType: doc.mimeType,
    storageKey: doc.storageKey,
    url: doc.url,
    thumbnailUrl: doc.thumbnailUrl ?? null,
    width: doc.width ?? null,
    height: doc.height ?? null,
    uploadedById: doc.uploadedById,
    createdAt: new Date(doc.createdAt ?? 0),
    updatedAt: new Date(doc.updatedAt ?? 0),
  };
}

/** Reconstruct project media (sort by sortOrder, attach file, drop file-less rows —
 * matches getProjectMediaFromConvex + withResolvedFile). */
function reconstructMedia(
  rows: MediaRow[],
  files: FileDoc[],
): Array<ProjectGalleryMedia & { file: GalleryFile }> {
  const fileMap = new Map(files.map((f) => [f.id, f]));
  return [...rows]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((m) => ({
      id: m.id,
      organizationId: m.organizationId,
      fileId: m.fileId,
      displayName: m.displayName ?? null,
      sortOrder: m.sortOrder ?? 0,
      createdAt: new Date(m.createdAt ?? 0),
      file: mapGalleryFile(fileMap.get(m.fileId)),
      projectId: m.projectId,
      type: (m.type ?? "OTHER") as ProjectGalleryMedia["type"],
    }))
    .filter((m): m is ProjectGalleryMedia & { file: GalleryFile } => m.file !== null);
}

// ─── Assembly ───────────────────────────────────────────────────────────────

type ManagerUser = { id: string; name: string; email: string; image: string | null };
type ProjectManagerOut = {
  id: string;
  organizationId: string;
  projectId: string;
  userId: string;
  addedAt: Date | null;
  user: ManagerUser | null;
};
type LocationWithParent =
  | (MappedLocation & { parent: MappedLocation | null })
  | null;

/** The overbooked flags `getProject` adds to each enriched line-item node. */
type OverbookedFields = { isOverbooked: boolean; overbookedInfo: OverbookedInfo | null };

type TopLineItem = ProjectEquipmentTree["lineItems"][number];
/** A top-level line item enriched with overbooked flags (children one level deep). */
export type EnrichedLineItem = TopLineItem &
  OverbookedFields & {
    childLineItems?: Array<NonNullable<TopLineItem["childLineItems"]>[number] & OverbookedFields>;
  };

export type NativeProjectDetail = ProjectRow & {
  projectManagers: ProjectManagerOut[];
  media: Array<ProjectGalleryMedia & { file: GalleryFile }>;
  location: LocationWithParent;
  categories: ProjectEquipmentTree["categories"];
  lineItems: EnrichedLineItem[];
  client: ProjectDetailBundle["client"];
};

function attachManagers(rows: ManagerRow[], users: UserDoc[]): ProjectManagerOut[] {
  const userMap = new Map<string, ManagerUser>(
    users.map((u) => [u.id, { id: u.id, name: u.name, email: u.email, image: u.image ?? null }]),
  );
  return [...rows]
    .sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0))
    .map((pm) => ({
      id: pm.id,
      organizationId: pm.organizationId,
      projectId: pm.projectId,
      userId: pm.userId,
      addedAt: pm.addedAt != null ? new Date(pm.addedAt) : null,
      user: userMap.get(pm.userId) ?? null,
    }));
}

function reconstructLocation(detail: ProjectDetailBundle): LocationWithParent {
  if (!detail.location) return null;
  const loc = mapLocation(detail.location) as MappedLocation & { parent: MappedLocation | null };
  loc.parent = detail.parentLocation ? mapLocation(detail.parentLocation) : null;
  // Inherit address/coordinates from parent when the child has none (mirrors getProject).
  if (loc.parent) {
    if (!loc.address) loc.address = loc.parent.address;
    if (loc.latitude == null && loc.longitude == null && loc.parent.latitude != null) {
      loc.latitude = loc.parent.latitude;
      loc.longitude = loc.parent.longitude;
    }
  }
  return loc;
}

/**
 * Apply the `lineItemId → OverbookedInfo` map onto the top-level line items + one
 * level of children, exactly as `getProject`'s `enrichedLineItems` does. An empty
 * map yields `isOverbooked: false` / `overbookedInfo: null` on every node (the
 * server's behaviour when nothing is overbooked).
 */
function applyOverbookedMap(
  lineItems: TopLineItem[],
  map: Map<string, OverbookedInfo>,
): EnrichedLineItem[] {
  return lineItems.map((li) => {
    const info = map.get(li.id);
    return {
      ...li,
      isOverbooked: !!info,
      overbookedInfo: info ?? null,
      childLineItems: li.childLineItems?.map((child) => {
        const childInfo = map.get(child.id);
        return {
          ...child,
          isOverbooked: !!childInfo,
          overbookedInfo: childInfo ?? null,
        };
      }),
    } as EnrichedLineItem;
  });
}

/**
 * Build the full getProject-shaped object from the native composites. `detail` is
 * the projectDetail.bundle (non-null), `equipment` the browserBundle.
 *
 * Line items start with default overbooked flags (`isOverbooked: false`); call
 * {@link enrichProjectDetailOverbooked} with the `overbooking.bundle` payload to
 * fill them in (reactively, once that subscription lands).
 */
export function reconstructProjectDetail(
  detail: ProjectDetailBundle,
  equipment: EquipmentBundleData,
): NativeProjectDetail {
  const project = mapProject(detail.project);
  const { categories, lineItems } = reconstructProjectEquipmentTree(equipment);
  return {
    ...project,
    projectManagers: attachManagers(detail.projectManagers, detail.managerUsers),
    media: reconstructMedia(detail.media, detail.mediaFiles),
    location: reconstructLocation(detail),
    categories,
    lineItems: applyOverbookedMap(lineItems, new Map()),
    client: detail.client,
  };
}

/**
 * Re-enrich a reconstructed project-detail's line items with overbooked flags from
 * the `overbooking.bundle` payload. Parity with `getProject`: the SAME nested
 * top-level `lineItems` array is passed to `reconstructOverbookedStatus` (kit
 * children nested under `childLineItems` are not flat-iterated), then the resulting
 * map is applied to the top level + one child level. `overbooking === undefined`
 * (still loading) returns the input unchanged — badges appear when it lands.
 */
export function enrichProjectDetailOverbooked(
  base: NativeProjectDetail,
  overbooking: OverbookingBundleData | undefined,
): NativeProjectDetail {
  if (!overbooking) return base;
  const map = reconstructOverbookedStatus(
    overbooking,
    base.lineItems,
    base.rentalStartDate,
    base.rentalEndDate,
    base.id,
  );
  return { ...base, lineItems: applyOverbookedMap(base.lineItems, map) };
}
