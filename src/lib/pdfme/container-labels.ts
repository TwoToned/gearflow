/**
 * Container & kit labels — the data behind the small tape-on-the-case label
 * (FEATUREDOCS/83). Pure: takes the rows `structureLineItemsByContainer`
 * already produced and returns one label model per container (or per kit), so
 * the renderer never re-derives who is packed where.
 *
 * Two rules that look odd and aren't:
 *  - **Accessories print quantity only, never an asset tag.** They are
 *    consumables-grade add-ons; the tag belongs to the parent they travel with.
 *  - **An accessory can travel in a different case than its parent.** Container
 *    membership is per unit, so we read the ACCESSORY child's own units. Only
 *    the case it is physically in lists it, as "accessory of <parent>, packed
 *    in <parent's case>" — the parent's label does NOT mention it (no pointer
 *    to the other case). Anything unpacked or in the parent's own case stays
 *    under the parent.
 *    (`structure-line-items-by-container.ts` deliberately keeps a kit's KIT
 *    children with the kit; this splitting is for ACCESSORY children only.)
 */
import type { DocumentLineItem } from "./types";

type Unit = NonNullable<DocumentLineItem["units"]>[number];

interface LabelAccessory {
  qty: number;
  name: string;
}

export interface LabelLine {
  qty: number;
  name: string;
  /** Serialised asset tags only (bulk lines carry none). */
  tags: string[];
  accessories: LabelAccessory[];
  /** Set on a line that is an accessory of a parent packed in another case. */
  accessoryOf?: { parentName: string; parentContainerLabel: string };
}

export interface ContainerLabel {
  /** The container's id, or the kit parent line item's id for a kit label. */
  id: string;
  kind: "container" | "kit";
  title: string;
  /** The container's / kit's own asset tag, when it has one. */
  tag: string | null;
  /** 1-based position among labels of this kind, for "2 of 6". */
  index: number;
  total: number;
  /** Where a kit label's kit is packed, when known. */
  packedIn: string | null;
  lines: LabelLine[];
  /** Everything physical packed in this box (accessories included; an accessory
   *  packed in another case counts there, not here). */
  itemCount: number;
}

function itemName(li: DocumentLineItem): string {
  return li.model?.name ?? li.description ?? li.kit?.name ?? "Item";
}

function serialisedTags(units: Unit[] | undefined): string[] {
  const tags = (units ?? []).map((u) => u.asset?.assetTag).filter((t): t is string => !!t);
  return [...new Set(tags)];
}

/** Majority container among a row's units (`null` = loose). */
function homeContainerId(li: DocumentLineItem): string | null {
  if (li.containerId !== undefined) return li.containerId;
  return null;
}

/** An accessory child's quantity split by the case each unit sits in. Units not
 *  yet assigned count toward `unassigned`, which stays with the parent. */
function splitAccessory(child: DocumentLineItem): { byContainer: Map<string, number>; unassigned: number } {
  const byContainer = new Map<string, number>();
  const units = child.units ?? [];
  for (const u of units) {
    if (!u.containerId) continue;
    byContainer.set(u.containerId, (byContainer.get(u.containerId) ?? 0) + 1);
  }
  const placed = [...byContainer.values()].reduce((a, b) => a + b, 0);
  return { byContainer, unassigned: Math.max(0, child.quantity - placed) };
}

function isParentRow(li: DocumentLineItem): boolean {
  return !li.isContainerRow && !li.isKitChild;
}

function accessoriesOf(li: DocumentLineItem): DocumentLineItem[] {
  return (li.childLineItems ?? []).filter((c) => c.childKind === "ACCESSORY");
}

function countItems(lines: LabelLine[]): number {
  return lines.reduce((sum, l) => sum + l.qty + l.accessories.reduce((s, a) => s + a.qty, 0), 0);
}

type Incoming = { containerId: string; line: LabelLine };

/** Splits one parent's ACCESSORY children by the case each unit sits in: what
 *  stays with the parent, and the `incoming` line the receiving case must list
 *  for what travels elsewhere (the parent's own label omits those). */
function placeAccessories(
  row: DocumentLineItem,
  home: string,
  labelById: Map<string, string>,
): { accessories: LabelAccessory[]; incoming: Incoming[] } {
  const accessories: LabelAccessory[] = [];
  const incoming: Incoming[] = [];
  for (const child of accessoriesOf(row)) {
    const { byContainer, unassigned } = splitAccessory(child);
    let stays = unassigned;
    for (const [cid, qty] of byContainer) {
      const elsewhereIn = cid === home ? undefined : labelById.get(cid);
      if (!elsewhereIn) {
        stays += qty;
        continue;
      }
      incoming.push({
        containerId: cid,
        line: {
          qty,
          name: itemName(child),
          tags: [],
          accessories: [],
          accessoryOf: { parentName: itemName(row), parentContainerLabel: labelById.get(home) ?? "another case" },
        },
      });
    }
    if (stays > 0) accessories.push({ qty: stays, name: itemName(child) });
  }
  return { accessories, incoming };
}

function parentLine(row: DocumentLineItem, accessories: LabelAccessory[]): LabelLine {
  if (row.kitId) {
    return { qty: row.quantity, name: row.kit?.name ?? itemName(row), tags: row.kit?.assetTag ? [row.kit.assetTag] : [], accessories };
  }
  return { qty: row.quantity, name: itemName(row), tags: serialisedTags(row.units), accessories };
}

/** A nested case is a line inside the case it's packed in. */
function nestedCaseLine(h: DocumentLineItem): LabelLine {
  return { qty: 1, name: h.description ?? "Container", tags: h.containerTag ? [h.containerTag] : [], accessories: [] };
}

/** One label per container, in the manifest's container order. */
export function buildContainerLabels(structured: DocumentLineItem[]): ContainerLabel[] {
  const headers = structured.filter((r) => r.isContainerRow);
  const idOf = (h: DocumentLineItem) => h.id.replace(/^container-/, "");
  const labelById = new Map(headers.map((h) => [idOf(h), h.description ?? "Container"]));
  const linesById = new Map<string, LabelLine[]>(headers.map((h) => [idOf(h), []]));
  // Collected first so the receiving case lists them whatever the row order.
  const incoming: Incoming[] = [];

  for (const row of structured.filter(isParentRow)) {
    const home = homeContainerId(row);
    const bucket = home ? linesById.get(home) : undefined;
    if (!home || !bucket) continue;
    if (row.fromKitName) {
      // Already hoisted into this case by structureLineItemsByContainer.
      bucket.push({
        qty: row.quantity,
        name: itemName(row),
        tags: [],
        accessories: [],
        accessoryOf: { parentName: row.fromKitName, parentContainerLabel: row.fromContainerLabel ?? "another case" },
      });
      continue;
    }
    const placed = placeAccessories(row, home, labelById);
    incoming.push(...placed.incoming);
    bucket.push(parentLine(row, placed.accessories));
  }
  for (const { containerId, line } of incoming) linesById.get(containerId)?.push(line);
  for (const h of headers) {
    if (h.containerParentId) linesById.get(h.containerParentId)?.push(nestedCaseLine(h));
  }

  return headers.map((h, i) => {
    const lines = linesById.get(idOf(h)) ?? [];
    return {
      id: idOf(h),
      kind: "container" as const,
      title: h.description ?? "Container",
      tag: h.containerTag ?? null,
      index: i + 1,
      total: headers.length,
      packedIn: h.containerParentId ? (labelById.get(h.containerParentId) ?? null) : null,
      lines,
      itemCount: countItems(lines),
    };
  });
}

/** One label per kit on the job (a kit parent line, e.g. an RF rack). */
export function buildKitLabels(structured: DocumentLineItem[]): ContainerLabel[] {
  const labelById = new Map(
    structured.filter((r) => r.isContainerRow).map((h) => [h.id.replace(/^container-/, ""), h.description ?? "Container"]),
  );
  const kits = structured.filter((r) => isParentRow(r) && !!r.kitId);
  return kits.map((kit, i) => {
    const members = (kit.childLineItems ?? []).filter((c) => c.childKind !== "ACCESSORY");
    const lines: LabelLine[] = members.map((m) => ({
      qty: m.quantity,
      name: itemName(m),
      tags: serialisedTags(m.units).length > 0 ? serialisedTags(m.units) : m.asset?.assetTag ? [m.asset.assetTag] : [],
      accessories: accessoriesOf(m).map((a) => ({ qty: a.quantity, name: itemName(a) })),
    }));
    const home = homeContainerId(kit);
    return {
      id: kit.id,
      kind: "kit" as const,
      title: kit.kit?.name ?? itemName(kit),
      tag: kit.kit?.assetTag ?? null,
      index: i + 1,
      total: kits.length,
      packedIn: home ? (labelById.get(home) ?? null) : null,
      lines,
      itemCount: countItems(lines),
    };
  });
}
