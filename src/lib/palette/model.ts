/**
 * The ⌘K palette as data (UX Phase 11, §6d.3). Pure: what the sections are,
 * in what order, with which rows, and where each row goes. The component
 * (`src/components/layout/palette/*`) only renders this and handles keys, so
 * the grouping, the four-row cap, `Show all n in X ›`, the empty state and the
 * no-match copy are pinned by `model.test.ts` without a DOM.
 */
import type { SearchResult, SearchResultType } from "@/lib/search-types";
import type { MatchedSlashCommand } from "@/lib/slash-commands";
import type { Crumb } from "@/lib/breadcrumbs";
import type { PaletteDate } from "@/lib/palette/date-query";
import { isRecentType, type RecentRef } from "../../../convex/lib/paletteRecentRefs";

// ─── Shapes ──────────────────────────────────────────────────────────────

export type PaletteAction =
  | { kind: "slash"; commandId: string }
  | { kind: "scan" }
  | { kind: "expand"; family: string };

export interface PaletteRow {
  id: string;
  /** The name. May be empty when the record is only its number (an asset with no custom name). */
  title: string;
  subtitle: string | null;
  /** A page-icon name (`FolderOpen`), or `type:<SearchResultType>` for a record. */
  icon: string;
  href?: string;
  /** The record's number, printed in mono before the name (`2341`, `AURA-01`). */
  mono?: string;
  /** A job's status, rendered as a dot-word. */
  status?: string;
  /** Muted text at the right (a type word, a `/command`). */
  hint?: string;
  isChild?: boolean;
  hasChildren?: boolean;
  children?: PaletteRow[];
  /** Opening this row records it in Recent. */
  recent?: RecentRef;
  action?: PaletteAction;
}

export interface PaletteSection {
  key: string;
  label: string | null;
  rows: PaletteRow[];
}

/** Server-side per-type match counts (`globalSearch.search`'s `groups`). */
export interface SearchGroupTotal {
  type: SearchResultType;
  total: number;
  truncated: boolean;
}

// ─── Families (the result groups) ────────────────────────────────────────

interface Family {
  key: string;
  label: string;
  types: readonly SearchResultType[];
  /** A list that reads `?q=`: `Show all` opens it; without one, `Show all` expands in place. */
  listHref?: string;
}

/** §6d.3's groups first (Jobs, Assets, Models, Clients, Crew, Suppliers, Locations), then the rest. */
const PALETTE_FAMILIES: readonly Family[] = [
  { key: "jobs", label: "Jobs", types: ["project"], listHref: "/projects" },
  { key: "assets", label: "Assets", types: ["asset", "bulk-asset", "kit"], listHref: "/assets/registry" },
  { key: "models", label: "Models", types: ["model"] },
  { key: "clients", label: "Clients", types: ["client"] },
  { key: "crew", label: "Crew", types: ["crew"] },
  { key: "suppliers", label: "Suppliers", types: ["supplier"] },
  { key: "locations", label: "Locations", types: ["location"] },
  { key: "categories", label: "Categories", types: ["category"] },
  { key: "maintenance", label: "Maintenance", types: ["maintenance"] },
  { key: "sub-hires", label: "Sub-hires", types: ["sub-hire"] },
  { key: "group-templates", label: "Group templates", types: ["group-template"] },
  { key: "check-items", label: "Check items", types: ["check-item"] },
];

/** Four rows per group, then `Show all n in X ›`. */
export const ROWS_PER_GROUP = 4;

const familyOf = (type: SearchResultType): Family =>
  PALETTE_FAMILIES.find((f) => f.types.includes(type)) ?? PALETTE_FAMILIES[PALETTE_FAMILIES.length - 1];

// ─── Rows ────────────────────────────────────────────────────────────────

/** Types whose title is `NUMBER — name`: the number prints in mono. */
const NUMBERED: ReadonlySet<SearchResultType> = new Set(["project", "kit", "asset", "sub-hire"]);

function splitNumber(type: SearchResultType, title: string): { mono?: string; title: string } {
  if (!NUMBERED.has(type)) return { title };
  const at = title.indexOf(" — ");
  return at < 0 ? { mono: title, title: "" } : { mono: title.slice(0, at), title: title.slice(at + 3) };
}

/** One search result (or resolved Recent row) as a palette row. */
export function recordRow(r: Pick<SearchResult, "id" | "type" | "title" | "subtitle" | "href" | "status" | "isChild">): PaletteRow {
  return {
    id: `${r.type}-${r.id}`,
    ...splitNumber(r.type, r.title),
    subtitle: r.subtitle,
    icon: `type:${r.type}`,
    href: r.href,
    status: r.type === "project" ? r.status : undefined,
    isChild: r.isChild || undefined,
    recent: isRecentType(r.type) ? { type: r.type, id: r.id } : undefined,
  };
}

/** The flat parent-then-children list as parents carrying their children. */
function nestResults(results: readonly SearchResult[]): { parent: SearchResult; row: PaletteRow }[] {
  const out: { parent: SearchResult; row: PaletteRow }[] = [];
  for (const r of results) {
    const last = out[out.length - 1];
    if (r.isChild && last) {
      last.row.children = [...(last.row.children ?? []), recordRow(r)];
      last.row.hasChildren = true;
    } else if (!r.isChild) {
      out.push({ parent: r, row: recordRow(r) });
    }
  }
  return out;
}

// ─── Search sections ─────────────────────────────────────────────────────

function familyTotal(f: Family, groups: readonly SearchGroupTotal[], parents: number): { total: number; truncated: boolean } {
  const mine = groups.filter((g) => f.types.includes(g.type));
  if (mine.length === 0) return { total: parents, truncated: false };
  return { total: mine.reduce((n, g) => n + g.total, 0), truncated: mine.some((g) => g.truncated) };
}

function showAllRow(f: Family, total: number, truncated: boolean, query: string): PaletteRow {
  return {
    id: `show-all-${f.key}`,
    title: `Show all ${total}${truncated ? "+" : ""} in ${f.label} ›`,
    subtitle: null,
    icon: "ChevronRight",
    href: f.listHref ? `${f.listHref}?q=${encodeURIComponent(query.trim())}` : undefined,
    action: f.listHref ? undefined : { kind: "expand", family: f.key },
  };
}

function familySection(f: Family, rows: PaletteRow[], groups: readonly SearchGroupTotal[], query: string, expanded: boolean): PaletteSection {
  const shown = expanded ? rows : rows.slice(0, ROWS_PER_GROUP);
  const { total, truncated } = familyTotal(f, groups, rows.length);
  // `Show all` only when it shows something more: a list to open, or hidden rows to expand.
  const more = total > shown.length && (f.listHref !== undefined || rows.length > shown.length);
  return { key: f.key, label: f.label, rows: more ? [...shown, showAllRow(f, total, truncated, query)] : shown };
}

/**
 * Search results as groups, best group first (the server already ranks, so a
 * group's place is where its best row first appears), four rows each. A group
 * with no row of its own but matches counted (assets listed under their
 * model) still gets its `Show all n in Assets ›` when it has a list to open.
 */
export function searchSections(
  results: readonly SearchResult[],
  groups: readonly SearchGroupTotal[],
  query: string,
  expandedFamilies: ReadonlySet<string>,
): PaletteSection[] {
  const byFamily = new Map<string, PaletteRow[]>();
  for (const { parent, row } of nestResults(results)) {
    const key = familyOf(parent.type).key;
    byFamily.set(key, [...(byFamily.get(key) ?? []), row]);
  }
  // A Map keeps insertion order: each family sits where its best (first) row appeared.
  const ranked = [...byFamily.keys()].map((key) => PALETTE_FAMILIES.find((f) => f.key === key) as Family);
  const listedOnly = PALETTE_FAMILIES.filter((f) => !byFamily.has(f.key) && f.listHref && familyTotal(f, groups, 0).total > 0);
  return [...ranked, ...listedOnly].map((f) => familySection(f, byFamily.get(f.key) ?? [], groups, query, expandedFamilies.has(f.key)));
}

// ─── Empty state ─────────────────────────────────────────────────────────

/** The slash commands the Actions group offers, in §6d.3's order, with its words. */
const ACTION_COMMANDS: readonly { id: string; title: string }[] = [
  { id: "global-new-project", title: "New job" },
  { id: "global-new-asset", title: "New asset" },
  { id: "global-new-client", title: "New client" },
];

/**
 * Actions: New job, Scan, New asset, New client. Gated: an action is present
 * only when its slash command survived `matchSlashCommands`' permission check
 * (`available`), and Scan only when the role reaches the warehouse.
 */
export function actionRows(available: readonly MatchedSlashCommand[], canScan: boolean): PaletteRow[] {
  const byId = new Map(available.map((m) => [m.command.id, m.command]));
  const row = (id: string, title: string): PaletteRow | null => {
    const cmd = byId.get(id);
    return cmd ? { id: `action-${id}`, title, subtitle: null, icon: cmd.icon, action: { kind: "slash", commandId: id } } : null;
  };
  const scan: PaletteRow | null = canScan ? { id: "action-scan", title: "Scan a tag", subtitle: null, icon: "ScanBarcode", action: { kind: "scan" } } : null;
  const [newJob, ...rest] = ACTION_COMMANDS.map((a) => row(a.id, a.title));
  return [newJob, scan, ...rest].filter((r): r is PaletteRow => r !== null);
}

/** A page's own slash commands as the `On #2341` group's rows. */
export function onPageRows(available: readonly MatchedSlashCommand[]): PaletteRow[] {
  return available
    .filter((m) => m.isPageSpecific)
    .map((m) => ({
      id: `slash-${m.command.id}`,
      title: m.command.label,
      subtitle: m.command.description,
      icon: m.command.icon,
      hint: `/${m.command.command}`,
      action: { kind: "slash", commandId: m.command.id } as const,
    }));
}

/** Pages whose record gets an `On …` group: a job, an asset, a kit, a model. */
const ON_PAGE_PREFIXES = ["/projects/", "/assets/registry/", "/assets/models/", "/kits/"];

/**
 * The `On #2341 Hilton gala` label: the trail's crumb for the record the page
 * is showing. Null off a record page, or before the page has named it.
 */
export function onPageLabel(pathname: string, trail: readonly Crumb[], entityId: string | null): string | null {
  if (!entityId || !ON_PAGE_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  const crumb = trail.find((c) => c.href?.endsWith(`/${entityId}`)) ?? (pathname.endsWith(`/${entityId}`) ? trail[trail.length - 1] : undefined);
  return crumb ? `On ${crumb.label}` : null;
}

/** Empty input: Recent (5), then `On …` (on a record page), then Actions. Empty groups are absent. */
export function emptySections(parts: { recent: PaletteRow[]; onPage: { label: string; rows: PaletteRow[] } | null; actions: PaletteRow[] }): PaletteSection[] {
  const sections: PaletteSection[] = [
    { key: "recent", label: "Recent", rows: parts.recent.slice(0, 5) },
    ...(parts.onPage ? [{ key: "on-page", label: parts.onPage.label, rows: parts.onPage.rows }] : []),
    { key: "actions", label: "Actions", rows: parts.actions },
  ];
  return sections.filter((s) => s.rows.length > 0);
}

// ─── Dates ───────────────────────────────────────────────────────────────

export interface DateJob {
  id: string;
  projectNumber: string;
  name: string;
  status: string;
  client?: { name?: string | null } | null;
}

function jobRow(j: DateJob): PaletteRow {
  return {
    id: `project-${j.id}`,
    mono: j.projectNumber,
    title: j.name,
    subtitle: j.client?.name ?? null,
    icon: "type:project",
    href: `/projects/${j.id}`,
    status: j.status,
    recent: { type: "project", id: j.id },
  };
}

/**
 * A date (`14/11`, `14 nov`): that day's jobs (from the Jobs list query, its
 * total in the label), the gear matching any words after the date, and the
 * Schedule for the day.
 */
export function dateSections(d: PaletteDate, jobs: { rows: DateJob[]; total: number } | undefined, gear: PaletteRow[]): PaletteSection[] {
  const sections: PaletteSection[] = [];
  if (jobs && jobs.rows.length > 0) {
    sections.push({ key: "date-jobs", label: `Jobs on ${d.label} · ${jobs.total}`, rows: jobs.rows.map(jobRow) });
  }
  if (gear.length > 0) sections.push({ key: "date-gear", label: `Gear on ${d.label}`, rows: gear });
  sections.push({
    key: "date-schedule",
    label: "Schedule",
    rows: [{ id: `date-${d.iso}`, title: `Schedule at ${d.label} ›`, subtitle: d.long, icon: "CalendarRange", href: `/availability?date=${d.iso}` }],
  });
  return sections;
}

// ─── Copy ────────────────────────────────────────────────────────────────

/** Nothing matched: say so, and say what to try next. */
export function noMatchCopy(query: string): { title: string; hint: string } {
  return {
    title: `Nothing matches “${query.trim()}”`,
    hint: "Try a job number, an asset tag or a client name · @ pages · / actions",
  };
}

// ─── Keyboard order ──────────────────────────────────────────────────────

/** Every selectable row in order: each row, then its children when they're shown. */
export function flattenSections(sections: readonly PaletteSection[], showChildren: boolean): PaletteRow[] {
  return sections.flatMap((s) => s.rows.flatMap((r) => (showChildren && r.children ? [r, ...r.children] : [r])));
}
