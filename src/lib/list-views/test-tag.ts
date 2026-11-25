/**
 * The Test and tag list as data (UX unification §9g, Phase 14a-3). Pure. `/test-and-tag` IS the list. Due,
 * Overdue, Passed and Failed are DERIVED on the server from the dates (`convex/lib/testTagListState.ts`),
 * never from the stored word the cron writes; this module only names and prints them.
 */
import type { ListFilterDef, ListSegment } from "@/components/ui/list-page-parts";
import { formatDate } from "@/lib/formatters";
import { LIST_PAGE_SIZE, type ListUrlSpec, type ListUrlState } from "@/lib/list-url-state";
import type { ActionMenuSpec, Fact, FactColumn, LineRowData, StatusValue } from "@/lib/primitives/types";
import { applianceTypeLabels, equipmentClassLabels } from "@/lib/status-labels";

const SEGMENT_DEFS = [
  { key: "due", label: "Due" },
  { key: "overdue", label: "Overdue" },
  { key: "passed", label: "Passed" },
  { key: "failed", label: "Failed" },
  { key: "all", label: "All" },
  { key: "retired", label: "Retired" },
] as const;

const LINKS = [
  { value: "serialized", label: "Serialised asset" },
  { value: "bulk", label: "Bulk line" },
  { value: "standalone", label: "Standalone" },
];

export const TEST_TAG_SPEC: ListUrlSpec = {
  segments: SEGMENT_DEFS.map((s) => s.key),
  filters: ["class", "type", "profile", "link"],
  sorts: ["testTagId", "description", "lastTest", "nextDue", "state", "equipmentClass", "applianceType"],
  defaultSort: "nextDue:asc",
};

export function testTagSegments(counts: Record<string, number | boolean> | undefined): ListSegment[] {
  return SEGMENT_DEFS.map((s) => ({ key: s.key, label: s.label, count: typeof counts?.[s.key] === "number" ? (counts[s.key] as number) : undefined }));
}

export function testTagFilters(profiles: { id: string; name: string }[]): ListFilterDef[] {
  const opt = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));
  return [
    { key: "class", label: "Class", options: opt(equipmentClassLabels) },
    { key: "type", label: "Type", options: opt(applianceTypeLabels) },
    { key: "profile", label: "Profile", options: profiles.map((p) => ({ value: p.id, label: p.name })) },
    { key: "link", label: "Link", options: LINKS },
  ];
}

export const TEST_TAG_ITEM_HEADER = "Item";
export const TEST_TAG_ITEM_SORT_KEY = "description";

/** Last test / Result / Next due / Tester by default; Class, Type, Profile and Linked asset are opt-in. */
export const TEST_TAG_COLUMNS: FactColumn[] = [
  { id: "lastTest", header: "Last test", sortKey: "lastTest" },
  { id: "result", header: "Result", sortKey: "state" },
  { id: "nextDue", header: "Next due", sortKey: "nextDue" },
  { id: "tester", header: "Tester" },
  { id: "class", header: "Class", sortKey: "equipmentClass", optional: true },
  { id: "type", header: "Appliance type", sortKey: "applianceType", optional: true },
  { id: "profile", header: "Profile", optional: true },
  { id: "asset", header: "Linked asset", optional: true },
];

const known = (values: string[] | undefined, allowed: readonly string[] | null): string[] | undefined => {
  const kept = allowed ? values?.filter((x) => allowed.includes(x)) : values;
  return kept?.length ? kept : undefined;
};

export function testTagQueryArgs(state: ListUrlState, now: number, dueSoonDays: number | undefined) {
  const f = state.filters;
  return {
    search: state.q.trim() || undefined,
    classIn: known(f.class, Object.keys(equipmentClassLabels)),
    typeIn: known(f.type, Object.keys(applianceTypeLabels)),
    profileIn: known(f.profile, null),
    linkIn: known(f.link, LINKS.map((l) => l.value)),
    segment: state.seg,
    dueSoonDays,
    // Due and Overdue read the clock: a mount-time snapshot, never a fresh Date.now() (it would re-key the subscription).
    now,
    page: state.page,
    pageSize: LIST_PAGE_SIZE,
    sortBy: state.sortBy,
    sortOrder: state.sortOrder,
  };
}

export interface TestTagSource {
  id: string;
  testTagId: string;
  description: string;
  equipmentClass: string | null;
  applianceType: string | null;
  profile: string | null;
  state: "RETIRED" | "FAILED" | "OVERDUE" | "DUE" | "PASSED";
  lastTestDate: number | null;
  nextDueDate: number | null;
  tester: string | null;
  linkedAsset: { id: string; assetTag: string } | null;
}

const STATE_STATUS: Record<TestTagSource["state"], StatusValue> = {
  OVERDUE: { label: "Overdue", intent: "error" },
  FAILED: { label: "Failed", intent: "error" },
  DUE: { label: "Due", intent: "warning" },
  PASSED: { label: "Passed", intent: "success" },
  RETIRED: { label: "Retired", intent: "neutral", outline: true },
};

const testTagStatus =(t: Pick<TestTagSource, "state">): StatusValue => STATE_STATUS[t.state];

const DASH: Fact = { kind: "text", label: "—" };
const dateFact = (ms: number | null): Fact => (ms == null ? DASH : { kind: "text", label: formatDate(new Date(ms)) });
const textFact = (s: string | null | undefined): Fact => (s ? { kind: "text", label: s } : DASH);

/** A failed item has no next due date until it is repaired and retested (D52): say so rather than print a blank. */
function nextDueFact(t: TestTagSource): Fact {
  return t.state === "FAILED" && t.nextDueDate == null ? { kind: "text", label: "After repair" } : dateFact(t.nextDueDate);
}

export function testTagRowOf(t: TestTagSource, menu?: ActionMenuSpec): LineRowData {
  const facts: Record<string, Fact> = {
    lastTest: dateFact(t.lastTestDate),
    result: { kind: "text", label: STATE_STATUS[t.state].label },
    nextDue: nextDueFact(t),
    tester: textFact(t.tester),
    class: textFact(t.equipmentClass ? (equipmentClassLabels[t.equipmentClass] ?? t.equipmentClass) : null),
    type: textFact(t.applianceType ? (applianceTypeLabels[t.applianceType] ?? t.applianceType) : null),
    profile: textFact(t.profile),
    asset: textFact(t.linkedAsset?.assetTag),
  };
  return { id: t.id, kind: "asset", title: t.description, subtitle: t.testTagId, facts, status: testTagStatus(t), menu, href: `/test-and-tag/${t.id}` };
}
