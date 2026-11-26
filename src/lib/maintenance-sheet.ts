import { blankToUndefined, changedEdit } from "@/lib/changed-edit";
import { fromDateInput, toDateInput } from "@/lib/date-input";
import { MAX_MAINTENANCE_MONEY } from "../../convex/lib/maintenanceCost";
import type { MaintenanceFormValues } from "@/lib/validations/maintenance";

/**
 * The maintenance Edit sheet's values and the write they become (UX Phase 14, 14b-3, §9n.3). Pure, so the sheet and its
 * tests share ONE mapping. The sheet carries every field the edit write sets (`MAINTENANCE_EDIT_FIELDS`) and NOTHING else:
 * status moves only through Complete / Reopen, and `partsUsed`, result and completed date are not its fields, so a save
 * can never clear one. A blank box CLEARS its field; labour is offered only to a caller whose read carried it.
 */
export interface MaintenanceSheetValues {
  title: string;
  type: string;
  description: string;
  /** `yyyy-mm-dd` or "". */
  scheduledDate: string;
  nextDueDate: string;
  assignedToId: string;
  reportedById: string;
  tags: string[];
  photos: string[];
  /** The labour box as typed ("" = blank). Never sent for a caller who cannot see job cost. */
  cost: string;
  assetIds: string[];
}

/** The record as `maintenanceRecords.recordDetail` returns it. `cost` is ABSENT for a caller who cannot see job cost. */
export interface MaintenanceSheetSource {
  id: string;
  title: string;
  type: string;
  status: string;
  description: string | null;
  scheduledDate: string | null;
  nextDueDate: string | null;
  assignedToId?: string | null;
  reportedById?: string | null;
  tags: string[];
  photos: string[];
  cost?: number | null;
  assets: Array<{ assetId: string }>;
}

export interface MaintenanceSheetInitial extends MaintenanceSheetValues {
  id: string;
  status: string;
  /** Whether the read carried the labour at all (false = the box is not offered and is never sent). */
  labourVisible: boolean;
}

const day = (iso: string | null): string => (iso ? toDateInput(Date.parse(iso)) : "");

export const EMPTY_MAINTENANCE_VALUES: MaintenanceSheetValues = {
  title: "", type: "REPAIR", description: "", scheduledDate: "", nextDueDate: "", assignedToId: "", reportedById: "", tags: [], photos: [], cost: "", assetIds: [],
};

/** The sheet's starting values from a record read: a stored `0` labour stays "0", never blank. */
export function maintenanceSheetInitialOf(r: MaintenanceSheetSource): MaintenanceSheetInitial {
  return {
    id: r.id,
    status: r.status,
    labourVisible: Object.hasOwn(r, "cost"),
    title: r.title,
    type: r.type,
    description: r.description ?? "",
    scheduledDate: day(r.scheduledDate),
    nextDueDate: day(r.nextDueDate),
    assignedToId: r.assignedToId ?? "",
    reportedById: r.reportedById ?? "",
    tags: r.tags ?? [],
    photos: r.photos ?? [],
    cost: r.cost == null ? "" : String(r.cost),
    assetIds: r.assets.map((a) => a.assetId),
  };
}

/** The membership is editable only while the job is Scheduled (it holds nothing then); after that Complete / Reopen own it. */
export const assetsEditable = (status: string): boolean => status === "SCHEDULED";

/** The one message that says what to fix in a values object, or `null` when it is saveable. */
export function maintenanceSheetError(v: MaintenanceSheetValues, o: { labourVisible: boolean; editingAssets: boolean }): string | null {
  if (!v.title.trim()) return "A job needs a title.";
  if (v.title.length > 200) return "The title can be at most 200 characters.";
  if (o.editingAssets && v.assetIds.length === 0) return "A job needs at least one asset.";
  if (o.labourVisible && v.cost.trim() !== "") {
    const n = Number(v.cost);
    if (!Number.isFinite(n) || n < 0 || n > MAX_MAINTENANCE_MONEY) return `Labour must be between 0 and ${MAX_MAINTENANCE_MONEY.toLocaleString("en-AU")}.`;
  }
  return null;
}

/**
 * A new job as the create write takes it: always Scheduled (status is not a field), with no labour (it is entered when the
 * job is completed, or from Edit). Blank optional boxes are simply absent.
 */
export function buildMaintenanceCreate(v: MaintenanceSheetValues): MaintenanceFormValues {
  return {
    status: "SCHEDULED",
    type: v.type as MaintenanceFormValues["type"],
    title: v.title.trim(),
    assetIds: v.assetIds,
    description: v.description.trim() || undefined,
    scheduledDate: v.scheduledDate || "",
    nextDueDate: v.nextDueDate || "",
    assignedToId: v.assignedToId || undefined,
    reportedById: v.reportedById || undefined,
    photos: v.photos,
    tags: v.tags,
  };
}

export interface MaintenanceEditInput {
  set: Record<string, unknown>;
  clear: string[];
  /** Present only when the membership actually changed (and the job is Scheduled). */
  assetIds?: string[];
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

/**
 * The edit write's input: ONLY the fields changed against the values the sheet opened with (`before`), so another user's
 * edit made since is never reverted. A changed blank clearable box CLEARS its field; labour only when the read carried
 * it; the asset list only when it changed and the job is Scheduled. Status is never in it.
 */
export function buildMaintenanceEdit(v: MaintenanceSheetValues, before: MaintenanceSheetInitial): MaintenanceEditInput {
  const day = (s: string): number | undefined => (s ? fromDateInput(s) : undefined);
  const labour = (s: string): number | undefined => (s.trim() === "" ? undefined : Number(s));
  const out: MaintenanceEditInput = changedEdit([
    ["title", v.title.trim(), before.title.trim()],
    ["type", v.type, before.type],
    ["tags", v.tags, before.tags],
    ["photos", v.photos, before.photos],
    ["description", blankToUndefined(v.description), blankToUndefined(before.description)],
    ["scheduledDate", day(v.scheduledDate), day(before.scheduledDate)],
    ["nextDueDate", day(v.nextDueDate), day(before.nextDueDate)],
    ["assignedToId", v.assignedToId || undefined, before.assignedToId || undefined],
    ["reportedById", v.reportedById || undefined, before.reportedById || undefined],
    ...(before.labourVisible ? [["cost", labour(v.cost), labour(before.cost)] as const] : []),
  ]);
  if (assetsEditable(before.status) && !sameIds(v.assetIds, before.assetIds)) out.assetIds = v.assetIds;
  return out;
}
