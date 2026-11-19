/**
 * The shared fixture of the Client view ↔ quote PDF parity gate (UX
 * unification §13). One set of FLAT Convex docs goes through the pipeline the
 * quote runs (mapLineItemDoc → reconstructScope → attach →
 * enrichDocumentLineItems → structureLineItems in collapse mode + billable
 * services); `modelTuples` is the quote's table model read as rows.
 *
 * Two test files consume it because the PDF text extractor only works in the
 * node environment and the view needs jsdom:
 *   - `equipment-client-view.parity.test.tsx` (jsdom): the view renders
 *     exactly `modelTuples`;
 *   - `equipment-client-view.parity-pdf.test.tsx` (node): the quote PDF
 *     prints every one of `modelTuples`, in order.
 * Together: the view and the PDF show the same rows.
 */
import { mapLineItemDoc } from "@/lib/project-line-item-read";
import { indexChildren, reconstructScope } from "@/lib/project-line-item-tree-read";
import { attachLineItemTree, type LineItemAttachMaps } from "@/lib/line-item-tree-read";
import type { ConvexModel } from "@/lib/models-read";
import type { ConvexSupplier } from "@/lib/suppliers-read";
import type { ConvexProjectService } from "@/lib/project-services-read";
import { enrichDocumentLineItems, buildBillableServiceRows, serializeDecimals } from "@/lib/pdfme/document-line-items";
import { structureLineItems, type CategoryForStructuring } from "@/lib/pdfme/structure-line-items";
import type { DocumentLineItem } from "@/lib/pdfme/types";
import { buildLineItemsTableModel, QUOTE_TABLE_CONFIG } from "@/lib/react-pdf/line-items-table-model";
import { toClientViewSections, type EquipmentClientView } from "@/lib/equipment-client-view";

const MS = 1_700_000_000_000;
let seq = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function doc(fields: Record<string, unknown>): any {
  seq += 1;
  return {
    _id: `cx${seq}`,
    _creationTime: 1,
    organizationId: "o",
    projectId: "p",
    type: "EQUIPMENT",
    quantity: 1,
    pricingType: "FLAT",
    duration: 1,
    sortOrder: seq * 10,
    status: "CONFIRMED",
    createdAt: MS,
    updatedAt: MS,
    ...fields,
  };
}

const lineItemDocs = [
  // ── Audio (itemised) ──
  doc({ id: "y8", modelId: "m-y8", categoryId: "cat-audio", quantity: 8, unitPrice: 120, lineTotal: 960 }),
  doc({ id: "kit", kitId: "k1", description: "ULXD4Q wireless kit", categoryId: "cat-audio", quantity: 2, unitPrice: 340, lineTotal: 680 }),
  doc({ id: "kitMember", modelId: "m-rx", isKitChild: true, childKind: "KIT", parentLineItemId: "kit", categoryId: "cat-audio" }),
  doc({ id: "beltpack", modelId: "m-sk", categoryId: "cat-audio", quantity: 6, unitPrice: 25, lineTotal: 150 }),
  doc({ id: "battery", modelId: "m-batt", isKitChild: true, childKind: "ACCESSORY", parentLineItemId: "beltpack", quantity: 12 }),
  doc({ id: "hazer", modelId: "m-hazer", categoryId: "cat-audio", unitPrice: 90, lineTotal: 90, isOptional: true }),
  doc({ id: "wash", modelId: "m-wash", categoryId: "cat-audio", quantity: 6, unitPrice: 60, lineTotal: 324, discount: 36, discountMode: "%" }),
  doc({ id: "sm58", type: "SALE", modelId: "m-sm58", categoryId: "cat-audio", quantity: 4, unitPrice: 180, lineTotal: 720 }),
  doc({ id: "axient", description: "Axient AD4Q package", categoryId: "cat-audio", subHireId: "sh1", showSubhireOnDocs: true, supplierId: "sup1", lineTotal: 500, unitPrice: 500 }),
  doc({ id: "rig", description: "Confidence monitor rig", categoryId: "cat-audio" }),
  // A priced Project Group: 2 of 4 members disclosed, plus a kit parent (never disclosed).
  doc({ id: "lectern", description: "Timber lectern", categoryId: "cat-audio", groupId: "g-lectern", showInGroupOnDocs: true }),
  doc({ id: "gooseneck", modelId: "m-mx418", categoryId: "cat-audio", groupId: "g-lectern", quantity: 2, showInGroupOnDocs: true }),
  doc({ id: "lecternLight", description: "Lectern light", categoryId: "cat-audio", groupId: "g-lectern" }),
  doc({ id: "antennaKit", kitId: "k2", description: "Antenna kit", categoryId: "cat-audio", groupId: "g-lectern", showInGroupOnDocs: true }),
  doc({ id: "antennaMember", description: "Paddle antenna", isKitChild: true, childKind: "KIT", parentLineItemId: "antennaKit" }),
  // ── Lighting (rolled up) ──
  doc({ id: "aura", modelId: "m-aura", categoryId: "cat-light", quantity: 12, unitPrice: 85, lineTotal: 1020, revealPriceInRollup: true }),
  doc({ id: "s4", modelId: "m-s4", categoryId: "cat-light", quantity: 4, unitPrice: 50, lineTotal: 200 }),
  doc({ id: "truss", description: "Truss 3 m", categoryId: "cat-light", groupId: "g-wash", quantity: 4 }),
  // ── An uncategorized group ──
  doc({ id: "spareMic", description: "Spare handheld", groupId: "g-spare", showInGroupOnDocs: true }),
];

function makeModel(id: string, name: string): ConvexModel {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { _id: `cm-${id}`, _creationTime: 1, id, organizationId: "o", name, isActive: true } as any;
}
const MODEL_NAMES = [
  ["m-y8", "Y8 loudspeaker"],
  ["m-rx", "ULXD4Q receiver"],
  ["m-sk", "EW-DX SK beltpack"],
  ["m-batt", "SB900B battery"],
  ["m-hazer", "Hazer MDG ATMe"],
  ["m-wash", "Rogue R2X wash"],
  ["m-sm58", "Shure SM58"],
  ["m-mx418", "MX418 gooseneck"],
  ["m-aura", "MAC Aura PXL"],
  ["m-s4", "Source Four LED"],
] as const;
const maps: LineItemAttachMaps = {
  models: new Map(MODEL_NAMES.map(([id, name]) => [id, makeModel(id, name)])),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  suppliers: new Map([["sup1", { _id: "cs1", _creationTime: 1, id: "sup1", organizationId: "o", name: "Scene Change" } as any as ConvexSupplier]]),
  categories: new Map(),
};

const CATS = { "cat-audio": { id: "cat-audio", name: "Audio" }, "cat-light": { id: "cat-light", name: "Lighting" } } as const;
const GROUPS = {
  "g-lectern": { id: "g-lectern", title: "Lectern package" },
  "g-wash": { id: "g-wash", title: "Stage wash package" },
  "g-spare": { id: "g-spare", title: "Spare package" },
} as const;

const categories: CategoryForStructuring[] = [
  {
    id: "cat-audio",
    name: "Audio",
    sortOrder: 0,
    pricingDisplay: "ITEMISED",
    groups: [{ id: "g-lectern", title: "Lectern package", description: null, quantity: 1, price: 850, discount: 85, discountMode: "%", sortOrder: 0 }],
  },
  {
    id: "cat-light",
    name: "Lighting",
    sortOrder: 1,
    pricingDisplay: "ROLLUP",
    groups: [{ id: "g-wash", title: "Stage wash package", description: null, quantity: 1, price: 460, discount: null, revealPriceInRollup: true, sortOrder: 0 }],
  },
  {
    // buildDocumentLineItemData's synthetic bucket for groups with no category.
    id: "__uncategorized__",
    name: "Uncategorized",
    sortOrder: Number.MAX_SAFE_INTEGER,
    pricingDisplay: "ITEMISED",
    groups: [{ id: "g-spare", title: "Spare package", description: null, quantity: 1, price: 200, discount: null, sortOrder: 0 }],
  },
];

const services = [
  { id: "s1", title: "Audio engineer", status: "CONFIRMED", lineTotal: 2100, unitPrice: 2100, discount: null, sortOrder: 0, description: null },
  { id: "s2", title: "Unpriced delivery", status: "CONFIRMED", lineTotal: 0, unitPrice: null, discount: null, sortOrder: 1, description: null },
] as unknown as ConvexProjectService[];

/** Lines the quote must never print: kit members, accessories, undisclosed
 *  group members, a kit parent inside a group, a $0 service. */
export const NEVER_PRINTED = [
  "ULXD4Q receiver",
  "SB900B battery",
  "Lectern light",
  "Antenna kit",
  "Paddle antenna",
  "Truss 3 m",
  "Unpriced delivery",
];

/** The quote's chain, on pure inputs (no Convex I/O). */
export function quoteLineItems(): DocumentLineItem[] {
  const lineItems = lineItemDocs.map(mapLineItemDoc);
  const tree = reconstructScope(lineItems, indexChildren(lineItems), { unitsByLineItem: new Map(), depth: 2 });
  // buildDocumentLineItemData's category/group selects, at levels 0 + 1.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const withCatGroup = (rows: any[]): any[] =>
    rows.map((r) => ({
      ...r,
      category: r.categoryId ? CATS[r.categoryId as keyof typeof CATS] : null,
      group: r.groupId ? GROUPS[r.groupId as keyof typeof GROUPS] : null,
      ...(Array.isArray(r.childLineItems) ? { childLineItems: withCatGroup(r.childLineItems) } : {}),
    }));
  const attached = attachLineItemTree(withCatGroup(tree), maps) as unknown as Array<{ id: string }>;
  const raw = serializeDecimals(enrichDocumentLineItems(attached, new Map(), new Map())) as unknown as DocumentLineItem[];
  const structured = structureLineItems(raw, categories, { expandProjectGroups: false, packerSort: false }, []);
  return [...structured, ...buildBillableServiceRows(services, { combine: false })];
}

/** What `getEquipmentClientView` returns for these items (totals aside). */
export function clientViewOf(items: DocumentLineItem[]): EquipmentClientView {
  return {
    sections: toClientViewSections(buildLineItemsTableModel(items, QUOTE_TABLE_CONFIG), QUOTE_TABLE_CONFIG),
    totals: { subtotal: null, discountAmount: null, taxAmount: null, total: null },
  };
}

export type Tuple = [section: string, rollup: string, name: string, qty: string, unit: string, discount: string, total: string, members: string];

/** The quote's rows: section, rollup, name, qty, unit, discount, total, disclosed members. */
export function modelTuples(view: EquipmentClientView): Tuple[] {
  return view.sections.flatMap((s) =>
    s.rows.map((r): Tuple => [
      s.title ?? "",
      s.rollupText ?? "",
      r.name,
      r.qty,
      r.unitPrice,
      r.discount,
      r.total,
      r.children.map((c) => `${c.name}×${c.qty}`).join(","),
    ]),
  );
}
