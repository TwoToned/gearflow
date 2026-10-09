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
    containerParentId: container.parentContainerId ?? null,
    containerItemCount: directMembers.length + directChildHeaderCount,
  };
}

function byCategoryThenKit(a: DocumentLineItem, b: DocumentLineItem): number {
  const ac = a.categoryName ?? "";
  const bc = b.categoryName ?? "";
  if (ac !== bc) return ac.localeCompare(bc);
  const an = a.model?.name ?? a.description ?? "";
  const bn = b.model?.name ?? b.description ?? "";
  return an.localeCompare(bn);
}

/** A kit/group parent moves as one row (its whole-row container); an
 *  ordinary line's units may genuinely split across containers, which
 *  fans out into one entry per container (defect §1.5 #7's "6 in Tub 3, 4
 *  in Tub 4" case). Split out of `structureLineItemsByContainer` to keep
 *  each helper's branching under the complexity ratchet (R-3.6). */
function placeLineIntoContainers(
  li: DocumentLineItem,
  byId: Map<string, ContainerForStructuring>,
): PlacedEntry[] {
  const isKitOrGroupParent = (!!li.kitId && !li.isKitChild) || li.isGroupRow;
  if (isKitOrGroupParent) {
    const containerId = resolveWholeRowContainerId(li);
    return [{ ...li, _containerId: containerId, _topId: topLevelAncestorId(containerId, byId) }];
  }

  const groups = groupUnitsByContainer(li.units);
  if (!groups || groups.size <= 1) {
    const containerId = groups ? [...groups.keys()][0] : null;
    return [{ ...li, _containerId: containerId, _topId: topLevelAncestorId(containerId, byId) }];
  }

  return [...groups].map(([containerId, units]) => ({
    ...li,
    id: `${li.id}__c-${containerId ?? "loose"}`,
    units,
    quantity: units.length,
    checkedOutQuantity: units.filter((u) => u.status === "CHECKED_OUT").length,
    _containerId: containerId,
    _topId: topLevelAncestorId(containerId, byId),
  }));
}

/** An ACCESSORY child can be packed in a different case than its parent
 *  (AA batteries in the battery box, the mic in the Pelican). Container
 *  membership is per unit, so hoist the units sitting in another KNOWN
 *  container out of the parent's `childLineItems` into their own entry in
 *  that container ("accessory of <parent>"). Mirrors container-labels.ts's
 *  `placeAccessories`; unassigned / same-case / unknown-container units stay
 *  nested under the parent. */
function hoistRelocatedAccessories(
  entries: PlacedEntry[],
  byId: Map<string, ContainerForStructuring>,
): PlacedEntry[] {
  const out: PlacedEntry[] = [];
  for (const e of entries) {
    const accessories = (e.childLineItems ?? []).filter((c) => c.childKind === "ACCESSORY");
    if (accessories.length === 0) { out.push(e); continue; }
    const parentName = e.model?.name ?? e.description ?? e.kit?.name ?? "Item";
    const hoisted: PlacedEntry[] = [];
    const kept = (e.childLineItems ?? []).flatMap((c) => {
      if (c.childKind !== "ACCESSORY") return [c];
      const away = (c.units ?? []).filter((u) => u.containerId && u.containerId !== e._containerId && byId.has(u.containerId));
      if (away.length === 0) return [c];
      const awayByContainer = new Map<string, UnitList>();
      for (const u of away) awayByContainer.set(u.containerId!, [...(awayByContainer.get(u.containerId!) ?? []), u]);
      for (const [cid, units] of awayByContainer) {
        hoisted.push({
          ...c,
          id: `${c.id}__c-${cid}`,
          units,
          quantity: units.length,
          checkedOutQuantity: units.filter((u) => u.status === "CHECKED_OUT").length,
          isKitChild: false,
          childKind: null,
          fromKitName: parentName,
          fromContainerLabel: e._containerId ? (byId.get(e._containerId)?.label ?? null) : null,
          _containerId: cid,
          _topId: topLevelAncestorId(cid, byId),
        });
      }
      const stays = (c.units ?? []).filter((u) => !away.includes(u));
      const stayQty = c.quantity - away.length;
      if (stayQty <= 0) return [];
      return [{ ...c, units: stays, quantity: stayQty, checkedOutQuantity: stays.filter((u) => u.status === "CHECKED_OUT").length }];
    });
    out.push({ ...e, childLineItems: kept }, ...hoisted);
  }
  return out;
}

/** Emits one top-level container's whole section: its own header, every
 *  nested container's header (indented), then its items sorted by
 *  category/kit. All rows share `top.label` as `groupName` so
 *  `filterAndGroupItems` buckets the whole section as one. */
function emitContainerSection(
  top: ContainerForStructuring,
  entries: PlacedEntry[],
  containers: ContainerForStructuring[],
  byId: Map<string, ContainerForStructuring>,
  sectionName: string,
): DocumentLineItem[] {
  const out: DocumentLineItem[] = [];
  const sectionMembers = entries.filter((e) => e._topId === top.id);
  const descendants = containers
    .filter((c) => topLevelAncestorId(c.id, byId) === top.id && c.id !== top.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const directChildContainerCount = (containerId: string): number =>
    descendants.filter((d) => d.parentContainerId === containerId).length;

  out.push(containerHeaderRow(
    top, 0, sectionName,
    sectionMembers.filter((e) => e._containerId === top.id),
    directChildContainerCount(top.id),
  ));
  for (const desc of descendants) {
    out.push(containerHeaderRow(
      desc, depthOf(desc.id, byId), sectionName,
      sectionMembers.filter((e) => e._containerId === desc.id),
      directChildContainerCount(desc.id),
    ));
  }

  for (const e of sectionMembers.sort(byCategoryThenKit)) {
    const { _containerId, _topId, ...rest } = e;
    void _topId;
    out.push({ ...rest, containerId: _containerId, groupName: sectionName, containerDepth: depthOf(e._containerId, byId) + 1 });
  }
  return out;
}

export function structureLineItemsByContainer(
  rawLineItems: DocumentLineItem[],
  containers: ContainerForStructuring[],
): DocumentLineItem[] {
  const byId = new Map(containers.map((c) => [c.id, c]));
  // A container line item is the box itself — a GEAR row, never one of its
  // own contents (it's the header now, matching structureLineItems' rule).
  const gearLines = rawLineItems.filter((li) => !li.isKitChild && !li.isContainerLineItem);
  const entries: PlacedEntry[] = hoistRelocatedAccessories(
    gearLines.flatMap((li) => placeLineIntoContainers(li, byId)),
    byId,
  );

  const structured: DocumentLineItem[] = [];
  const topLevel = containers
    .filter((c) => !c.parentContainerId || !byId.has(c.parentContainerId))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  // `groupName` is the section's bucket/filter key, so two cases sharing a
  // label ("Pelican 1450" ×2) MUST get distinct keys — otherwise they merge
  // into one bucket and an EMPTY case's header survives the status filter on
  // its namesake's items. The header still prints `description`/tag, not this.
  const labelCounts = new Map<string, number>();
  for (const t of topLevel) labelCounts.set(t.label, (labelCounts.get(t.label) ?? 0) + 1);
  for (const top of topLevel) {
    const sectionName = (labelCounts.get(top.label) ?? 0) > 1 ? `${top.label} [${top.id}]` : top.label;
    structured.push(...emitContainerSection(top, entries, containers, byId, sectionName));
  }

  const loose = entries.filter((e) => e._topId === null && e._containerId === null).sort(byCategoryThenKit);
  for (const e of loose) {
    const { _containerId, _topId, ...rest } = e;
    void _containerId; void _topId;
    structured.push({ ...rest, groupName: "Loose" });
  }

  return structured;
}
