/**
 * The pull list: ONE definition shared by the pull-slip PDF
 * (`react-pdf/packing-list-document.tsx`) and the floor's pull-sheet dialog
 * (`src/server/warehouse.ts` `getPullSheet`) — R-3.1, plan Q13. Both read the
 * same `buildDocumentData(…, "packing-list")` rows and group them with the same
 * `filterAndGroupItems` under this config, so the sheet a packer prints from
 * the screen and the PDF they save can never list different gear.
 *
 * Plain module (no `@react-pdf/renderer`), so a client type import is safe.
 */
import type { DocumentLineItem } from "./types";
import type { TableModelConfig } from "@/lib/react-pdf/line-items-table-model";
import { getAssetTag } from "./line-item-format";

export const PULL_LIST_TABLE_CONFIG = {
  documentType: "packing-list",
  showGroupHeaders: true,
  showKitChildren: true,
  showCheckboxes: true,
  showConditionColumns: false,
  showPricing: false,
  showBadges: false,
  showNotes: false,
  showPerUnitCheckboxes: true,
  showAssetTags: true,
  showCategories: true,
  showRowNumbers: false,
  filterOptional: false,
  filterByStatus: null,
  hidePricingPeriodSuffix: false,
} as const satisfies TableModelConfig;

/** One printable pull-sheet row (serialisable, for the dialog). */
export interface PullRow {
  id: string;
  name: string;
  quantity: number;
  tag: string;
  location: string;
  kind: "item" | "kit" | "group" | "accessory" | "member";
  /** Hired in: the supplier, else null. */
  supplier: string | null;
  /** Overbooked (`short` on paper); `inside` when only a member is. */
  short: "self" | "inside" | null;
  children: PullRow[];
}

function rowName(i: DocumentLineItem): string {
  if (i.kitId && !i.isKitChild) return i.description || i.kit?.name || "Kit";
  if (i.model) return [i.model.name, i.model.modelNumber].filter(Boolean).join(" - ");
  return i.description || "Unnamed item";
}

function rowKind(i: DocumentLineItem, nested: boolean): PullRow["kind"] {
  if (i.isGroupRow) return "group";
  if (i.kitId && !i.isKitChild) return "kit";
  if (!nested) return "item";
  return i.childKind === "ACCESSORY" ? "accessory" : "member";
}

function shortOf(i: DocumentLineItem): PullRow["short"] {
  if (!i.isOverbooked) return null;
  return i.overbookedInherited ? "inside" : "self";
}

/** A document row → a pull-sheet row (children nested once more at most). */
export function toPullRow(i: DocumentLineItem, nested = false): PullRow {
  const isKit = !!i.kitId && !i.isKitChild;
  return {
    id: i.id,
    name: rowName(i),
    quantity: i.quantity,
    tag: getAssetTag(i, isKit),
    location: i.locationName ?? "",
    kind: rowKind(i, nested),
    supplier: i.subHireId != null ? i.supplierName ?? null : null,
    short: shortOf(i),
    children: (i.childLineItems ?? []).map((c) => toPullRow(c, true)),
  };
}
