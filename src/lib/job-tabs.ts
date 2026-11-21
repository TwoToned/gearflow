/**
 * The job page's tabs (`/projects/[id]`): the keys a `?tab=` deep link can name,
 * the aliases old links use, and the labels with their counts (spec §6b, §10).
 *
 * `VALID_TABS` used to be a local constant in the page. It lives here now, so the
 * deep-link rule is unit-tested and the tab owners (Phase 8's Packing and
 * Versions) feed their counts without editing the page. A key is only
 * *available* when the page supplies a panel for it, so a template, which has
 * no Packing, Finance or Versions, can never land on an empty tab.
 */
import type { TabStripItem } from "@/components/ui/tab-strip";
import { MODULE_NAMES } from "@/lib/vocabulary";

/** In strip order. `labour` is the Logistics tab (the value is kept so old links work). */
export const JOB_TAB_KEYS = [
  "overview", "equipment", "packing", "labour", "finance", "tasks", "notes", "files", "versions",
] as const;
export type JobTabKey = (typeof JOB_TAB_KEYS)[number];

/** Old `?tab=` values that still land: the Work-layer rename and the Logistics word. */
export const JOB_TAB_ALIASES: Readonly<Record<string, JobTabKey>> = { work: "tasks", logistics: "labour" };

/** Tabs a template never has (it has no pipeline, no finance and no versions). */
const NOT_ON_TEMPLATES: ReadonlySet<JobTabKey> = new Set(["packing", "finance", "versions"]);

const LABELS: Record<JobTabKey, string> = {
  overview: "Overview",
  equipment: "Equipment",
  packing: "Packing",
  labour: MODULE_NAMES.logistics,
  finance: "Finance",
  tasks: "Tasks",
  notes: "Notes",
  files: "Files",
  versions: "Versions",
};

/** What each tab owner feeds into its label. `undefined` = no count shown. */
export interface JobTabCounts {
  tasks?: { done: number; total: number };
  files?: number;
  /** `Packing 36/44`: planned / total (Phase 8 owns the derivation). */
  packing?: { planned: number; total: number };
  /** `Versions 3`. */
  versions?: number;
}

function isJobTabKey(value: string): value is JobTabKey {
  return (JOB_TAB_KEYS as readonly string[]).includes(value);
}

/** The keys this job shows, in strip order. */
export function availableJobTabs(opts: { isTemplate: boolean; panels: ReadonlySet<JobTabKey> }): JobTabKey[] {
  return JOB_TAB_KEYS.filter((k) => opts.panels.has(k) && !(opts.isTemplate && NOT_ON_TEMPLATES.has(k)));
}

/**
 * `?tab=` → the tab to open. An alias resolves first; anything unknown or not
 * available on this job lands on Overview, the job's home (#1061).
 */
export function resolveJobTab(param: string | null | undefined, available: readonly JobTabKey[]): JobTabKey {
  const raw = param ? (JOB_TAB_ALIASES[param] ?? param) : "";
  return isJobTabKey(raw) && available.includes(raw) ? raw : "overview";
}

/** `9/14`, or nothing when there is nothing to count. */
const fraction = (done: number, total: number) => (total > 0 ? `${done}/${total}` : undefined);

const COUNT: Partial<Record<JobTabKey, (c: JobTabCounts) => string | number | undefined>> = {
  tasks: (c) => (c.tasks ? fraction(c.tasks.done, c.tasks.total) : undefined),
  files: (c) => c.files || undefined,
  packing: (c) => (c.packing ? fraction(c.packing.planned, c.packing.total) : undefined),
  versions: (c) => c.versions || undefined,
};

/** The `TabStrip` items: underlined words with muted counts (`Tasks 9/14`). */
export function jobTabItems(available: readonly JobTabKey[], counts: JobTabCounts): TabStripItem[] {
  return available.map((value) => ({ value, label: LABELS[value], count: COUNT[value]?.(counts) }));
}
