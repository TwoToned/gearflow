/**
 * `byContainer` structuring (#1296 packing containers, build plan phase 3a) —
 * sorts a project's gear into containers first, sub-sorted by category/kit
 * inside, then a "Loose" bucket last. Used by the manifest, delivery-docket
 * and return-sheet doc types (`structure-line-items.ts`'s `StructureOptions.
 * byContainer` delegates here).
 *
 * Reuses the EXISTING flat groupName-bucket mechanism `filterAndGroupItems`
 * (line-items-table.tsx) already draws category sections from, rather than
 * inventing a second nesting model: every row belonging to one TOP-LEVEL
 * container (including its own header row and any NESTED container's header
 * + members) shares that top container's `groupName`, so the renderer's
 * existing one-header-per-bucket walk draws it as one section; `containerDepth`
 * on each row is what indents a nested container's own header + members
 * within that shared section. A row bucketed by category/kit still carries
 * its own `categoryName`/kit fields for the renderer to label individual
 * rows within the section (see FEATUREDOCS/13 for the full consumer list).
 *
 * Container membership comes from the line's OWN `units[]` — nesting needs
 * no separate lookup: a container packed inside another is itself just a
 * line item, and if it was physically packed via `prepUnit`, ITS unit
 * already carries the outer box's id (mirrors fulfillment.ts's
 * `syncContainerStatuses` comment). A kit parent / Project Group moves as
 * ONE row (never split across containers) — resolved from its own units,
 * falling back to its children's majority container. D3's "a stray kit
 * member packed elsewhere prints once under its actual container" is NOT
 * implemented here (documented simplification, `fromKitName` stays unused
 * for now) — the whole kit moves together, matching D3's stated DEFAULT.
 * An ordinary line whose OWN units genuinely split across containers (a
 * bulk line packed 6-into-Tub-3, 4-into-Tub-4) DOES split into one row per
 * container, each carrying only that subset's units/quantity.
 */
import type { DocumentLineItem } from "./types";

export interface ContainerForStructuring {
  id: string;
  kind: "ASSET" | "BULK_ASSET" | "CUSTOM";
  label: string;
  description?: string | null;
  /** The container's own asset/bulk-asset tag, pre-resolved by the caller. */
  tag?: string | null;
  parentContainerId?: string | null;
  sortOrder: number;
}

type UnitList = NonNullable<DocumentLineItem["units"]>;

function groupUnitsByContainer(units: UnitList | undefined): Map<string | null, UnitList> | null {
  if (!units || units.length === 0) return null;
  const m = new Map<string | null, UnitList>();
  for (const u of units) {
    const key = u.containerId ?? null;
    const arr = m.get(key);
    if (arr) arr.push(u);
    else m.set(key, [u]);
  }
  return m;
}

/** The container id most of a unit list's members share (ties broken by
 *  insertion order) — `null` (Loose) when every unit is unpacked. */
function majorityContainerId(units: UnitList): string | null {
  const counts = new Map<string | null, number>();
  for (const u of units) {
    const key = u.containerId ?? null;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = -1;
  for (const [key, n] of counts) {
    if (n > bestN) { best = key; bestN = n; }
  }
  return best;
}

/** A kit parent / Project Group's container: its own units if it has any
 *  (a serialised kit case), else its children's majority (D3's default —
 *  the whole kit moves together). */
function resolveWholeRowContainerId(li: DocumentLineItem): string | null {
  if (li.units && li.units.length > 0) return majorityContainerId(li.units);
  const childUnits = (li.childLineItems ?? []).flatMap((c) => c.units ?? []);
  if (childUnits.length > 0) return majorityContainerId(childUnits);
  return null;
}

function depthOf(containerId: string | null, byId: Map<string, ContainerForStructuring>): number {
  let depth = 0;
  let cur = containerId ? byId.get(containerId) : undefined;
  while (cur?.parentContainerId && byId.has(cur.parentContainerId)) {
    cur = byId.get(cur.parentContainerId);
    depth++;
  }
  return depth;
}

function topLevelAncestorId(containerId: string | null, byId: Map<string, ContainerForStructuring>): string | null {
  let cur = containerId ? byId.get(containerId) : undefined;
  if (!cur) return null;
  while (cur.parentContainerId && byId.has(cur.parentContainerId)) cur = byId.get(cur.parentContainerId)!;
  return cur.id;
}

type PlacedEntry = DocumentLineItem & {
  /** The container this row is DIRECTLY packed in (null = Loose). */
  _containerId: string | null;
  /** The TOP-LEVEL container that owns the section this row prints in. */
  _topId: string | null;
};

/** Derive a container header's status from what's actually inside it —
 *  CLAUDE.md's synthetic-row rule (never hard-code a synthetic row's
 *  status). `members` are every row (item or nested header) directly or
 *  transitively inside this container. */
function deriveContainerStatus(members: DocumentLineItem[]): string {
  if (members.length === 0) return "CONFIRMED";
  if (members.every((m) => m.status === "CHECKED_OUT")) return "CHECKED_OUT";
  if (members.every((m) => m.status === "RETURNED")) return "RETURNED";
  return "CONFIRMED";
}

function containerHeaderRow(
  container: ContainerForStructuring,
  depth: number,
  groupName: string,
  directMembers: DocumentLineItem[],
  directChildHeaderCount: number,
): DocumentLineItem {
  return {
    id: `container-${container.id}`,
    description: container.label,
    quantity: 1,
    checkedOutQuantity: 0,
    unitPrice: null,
    pricingType: "FLAT",
    duration: 1,
    discount: null,
    lineTotal: null,
    groupName,
    categoryName: null,
    groupTitle: null,
    isOptional: false,
    notes: container.description ?? null,
    status: deriveContainerStatus(directMembers),
    model: null,
    asset: null,
    bulkAsset: null,
    isContainerRow: true,
    containerKind: container.kind,
    containerTag: container.tag ?? null,
    containerDescription: container.description ?? null,
    containerDepth: depth,
    containerItemCount: directMembers.length + directChildHeaderCount,
  };
}

export function structureLineItemsByContainer(
  rawLineItems: DocumentLineItem[],
  containers: ContainerForStructuring[],
): DocumentLineItem[] {
  const byId = new Map(containers.map((c) => [c.id, c]));
  // A container line item is the box itself — a GEAR row, never one of its
  // own contents (it's the header now, matching structureLineItems' rule).
  const gearLines = rawLineItems.filter((li) => !li.isKitChild && !li.isContainerLineItem);

  const entries: PlacedEntry[] = [];
  for (const li of gearLines) {
    const isKitOrGroupParent = (!!li.kitId && !li.isKitChild) || li.isGroupRow;
    if (isKitOrGroupParent) {
      const containerId = resolveWholeRowContainerId(li);
      entries.push({ ...li, _containerId: containerId, _topId: topLevelAncestorId(containerId, byId) });
      continue;
    }

    const groups = groupUnitsByContainer(li.units);
    if (!groups || groups.size <= 1) {
      const containerId = groups ? [...groups.keys()][0] : null;
      entries.push({ ...li, _containerId: containerId, _topId: topLevelAncestorId(containerId, byId) });
      continue;
    }

    // Genuinely split across containers — one row per container, carrying
    // only that subset (defect §1.5 #7's "6 in Tub 3, 4 in Tub 4" case).
    for (const [containerId, units] of groups) {
      entries.push({
        ...li,
        id: `${li.id}__c-${containerId ?? "loose"}`,
        units,
        quantity: units.length,
        checkedOutQuantity: units.filter((u) => u.status === "CHECKED_OUT").length,
        _containerId: containerId,
        _topId: topLevelAncestorId(containerId, byId),
      });
    }
  }

  const byCategoryThenKit = (a: DocumentLineItem, b: DocumentLineItem): number => {
    const ac = a.categoryName ?? "";
    const bc = b.categoryName ?? "";
    if (ac !== bc) return ac.localeCompare(bc);
    const an = a.model?.name ?? a.description ?? "";
    const bn = b.model?.name ?? b.description ?? "";
    return an.localeCompare(bn);
  };

  const structured: DocumentLineItem[] = [];
  const topLevel = containers
    .filter((c) => !c.parentContainerId || !byId.has(c.parentContainerId))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const descendantsOf = (rootId: string): ContainerForStructuring[] =>
    containers.filter((c) => topLevelAncestorId(c.id, byId) === rootId && c.id !== rootId).sort((a, b) => a.sortOrder - b.sortOrder);

  for (const top of topLevel) {
    const sectionMembers = entries.filter((e) => e._topId === top.id);
    const descendants = descendantsOf(top.id);
    const directChildContainerCount = (containerId: string): number =>
      descendants.filter((d) => d.parentContainerId === containerId).length;

    // Every row in this TOP-LEVEL container's section — header(s) + items —
    // shares ONE groupName so filterAndGroupItems buckets them as one section.
    structured.push(containerHeaderRow(
      top, 0, top.label,
      sectionMembers.filter((e) => e._containerId === top.id),
      directChildContainerCount(top.id),
    ));
    for (const desc of descendants) {
      structured.push(containerHeaderRow(
        desc, depthOf(desc.id, byId), top.label,
        sectionMembers.filter((e) => e._containerId === desc.id),
        directChildContainerCount(desc.id),
      ));
    }

    const items = sectionMembers.sort(byCategoryThenKit);
    for (const e of items) {
      const { _containerId, _topId, ...rest } = e;
      void _containerId; void _topId;
      structured.push({ ...rest, groupName: top.label, containerDepth: depthOf(e._containerId, byId) + 1 });
    }
  }

  const loose = entries.filter((e) => e._topId === null && e._containerId === null).sort(byCategoryThenKit);
  for (const e of loose) {
    const { _containerId, _topId, ...rest } = e;
    void _containerId; void _topId;
    structured.push({ ...rest, groupName: "Loose" });
  }

  return structured;
}
