/**
 * The Maintenance list as data (UX unification §9g, Phase 14a-3). Pure. The segments are DERIVED on the server
 * from `convex/lib/maintenanceOpen.ts` (the same Open / Overdue Home and the More sheet count by); this module
 * only names and prints them. `Cost` is opt-in and ABSENT from the payload for a caller who cannot see job cost.
 */
import type { ListFilterDef, ListSegment } from "@/components/ui/list-page-parts";
import { formatDate } from "@/lib/formatters";
import { LIST_PAGE_SIZE, type ListUrlSpec, type ListUrlState } from "@/lib/list-url-state";
import type { ActionMenuSpec, Fact, FactColumn, LineRowData, RowFlag, StatusValue } from "@/lib/primitives/types";
import { maintenanceResultLabels, maintenanceStatusLabels, maintenanceTypeLabels } from "@/lib/status-labels";

const SEGMENT_DEFS = [
  { key: "open", label: "Open" },
  { key: "overdue", label: "Overdue" },
  { key: "scheduled", label: "Scheduled" },
  { key: "done", label: "Done" },
  { key: "all", label: "All" },
] as const;

const TYPES = ["REPAIR", "PREVENTATIVE", "TEST_AND_TAG", "INSPECTION", "CLEANING", "FIRMWARE_UPDATE"] as const;
const STATUSES = ["SCHEDULED", "AWAITING_PARTS", "IN_PROGRESS", "QA", "COMPLETED", "CANCELLED"] as const;
const RESULTS = ["PASS", "FAIL", "CONDITIONAL"] as const;

export const MAINTENANCE_SPEC: ListUrlSpec = {
  segments: SEGMENT_DEFS.map((s) => s.key),
  filters: ["type", "status", "result"],
  sorts: ["title", "type", "status", "scheduledDate", "completedDate", "cost"],
  defaultSort: "scheduledDate:asc",
};

export function maintenanceSegments(counts: Record<string, number | boolean> | undefined): ListSegment[] {
  return SEGMENT_DEFS.map((s) => ({ key: s.key, label: s.label, count: typeof counts?.[s.key] === "number" ? (counts[s.key] as number) : undefined }));
}

export function maintenanceFilters(): ListFilterDef[] {
  const opt = (values: readonly string[], labels: Record<string, string>) => values.map((v) => ({ value: v, label: labels[v] ?? v }));
  return [
    { key: "type", label: "Type", options: opt(TYPES, maintenanceTypeLabels) },
    { key: "status", label: "Status", options: opt(STATUSES, maintenanceStatusLabels) },
    { key: "result", label: "Result", options: opt(RESULTS, maintenanceResultLabels) },
  ];
}

export const MAINTENANCE_ITEM_HEADER = "Job";
export const MAINTENANCE_ITEM_SORT_KEY = "title";

/** Asset / Status / Due / Assigned by default; Cost, Reported by, Completed and Tags are opt-in (D43). */
export const MAINTENANCE_COLUMNS: FactColumn[] = [
  { id: "asset", header: "Asset" },
  { id: "status", header: "Status", sortKey: "status" },
  { id: "due", header: "Due", sortKey: "scheduledDate" },
  { id: "assigned", header: "Assigned" },
  { id: "cost", header: "Cost", align: "end", sortKey: "cost", optional: true },
  { id: "reportedBy", header: "Reported by", optional: true },
  { id: "completed", header: "Completed", sortKey: "completedDate", optional: true },
  { id: "tags", header: "Tags", optional: true },
];

const known = (list: readonly string[], values: string[] | undefined): string[] | undefined => {
  const kept = values?.filter((x) => list.includes(x));
  return kept?.length ? kept : undefined;
};

export function maintenanceQueryArgs(state: ListUrlState, now: number) {
  const f = state.filters;
  return {
    search: state.q.trim() || undefined,
    typeIn: known(TYPES, f.type),
    statusIn: known(STATUSES, f.status),
    resultIn: known(RESULTS, f.result),
    segment: state.seg,
    // Overdue reads the clock: a mount-time snapshot, never a fresh Date.now() (it would re-key the subscription).
    now,
    page: state.page,
    pageSize: LIST_PAGE_SIZE,
    sortBy: state.sortBy,
    sortOrder: state.sortOrder,
  };
}

export interface MaintenanceSource {
  id: string;
  title: string;
  type: string;
  status: string;
  result: string | null;
  overdue: boolean;
  scheduledDate: number | null;
  completedDate: number | null;
  tags: string[];
  reportedBy: string | null;
  assignedTo: string | null;
  assets: { id: string; assetTag: string; model: string }[];
  /** Absent for a caller who cannot see job cost. */
  cost?: number | null;
}

const STATUS_INTENT: Record<string, StatusValue["intent"]> = {
  SCHEDULED: "info",
  AWAITING_PARTS: "warning",
  IN_PROGRESS: "primary",
  QA: "warning",
  COMPLETED: "success",
  CANCELLED: "neutral",
};

const day = (ms: number) => formatDate(new Date(ms));
const DASH: Fact = { kind: "text", label: "—" };

export function maintenanceStatus(m: Pick<MaintenanceSource, "status" | "overdue">): StatusValue {
  if (m.overdue) return { label: "Overdue", intent: "error" };
  return { label: maintenanceStatusLabels[m.status] ?? m.status, intent: STATUS_INTENT[m.status] ?? "neutral", outline: m.status === "CANCELLED" };
}

/** `HZ-1 Hazer` and `+2 more`. */
function assetText(a: MaintenanceSource["assets"]): Fact {
  if (a.length === 0) return DASH;
  const first = [a[0].assetTag, a[0].model].filter(Boolean).join(" ");
  return { kind: "text", label: a.length > 1 ? `${first} +${a.length - 1} more` : first };
}

/** Pure: the opt-in facts a row carries (only what is present: cost is absent, not blank, without permission). */
function optionalFacts(m: MaintenanceSource): Record<string, Fact> {
  const out: Record<string, Fact> = {};
  if ("cost" in m) out.cost = { kind: "money", amount: m.cost ?? null };
  if (m.reportedBy) out.reportedBy = { kind: "text", label: m.reportedBy };
  if (m.completedDate != null) out.completed = { kind: "text", label: day(m.completedDate) };
  if (m.tags.length) out.tags = { kind: "text", label: m.tags.join(", ") };
  return out;
}

export function maintenanceFlags(m: Pick<MaintenanceSource, "result">): RowFlag[] {
  return m.result === "FAIL" ? [{ label: "Failed", tone: "error" }] : [];
}

export function maintenanceRowOf(m: MaintenanceSource, menu?: ActionMenuSpec): LineRowData {
  const facts: Record<string, Fact> = {
    asset: assetText(m.assets),
    status: { kind: "text", label: maintenanceStatusLabels[m.status] ?? m.status },
    due: m.scheduledDate != null ? { kind: "text", label: day(m.scheduledDate) } : DASH,
    assigned: m.assignedTo ? { kind: "text", label: m.assignedTo } : DASH,
    ...optionalFacts(m),
  };
  return {
    id: m.id,
    kind: "asset",
    title: m.title,
    subtitle: maintenanceTypeLabels[m.type] ?? m.type,
    tags: m.tags.length ? m.tags : undefined,
    flags: maintenanceFlags(m),
    facts,
    status: maintenanceStatus(m),
    menu,
    href: `/maintenance/${m.id}`,
  };
}
