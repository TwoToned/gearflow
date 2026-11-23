"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useGlobalSearch } from "@/hooks/use-global-search";
import { useStableNow } from "@/hooks/use-stable-now";
import { usePaletteRecents } from "@/hooks/use-palette-recents";
import { useCurrentRole } from "@/lib/use-permissions";
import { useTrail } from "@/components/layout/breadcrumbs";
import { matchSlashCommands, extractEntityId } from "@/lib/slash-commands";
import type { PageCommand } from "@/lib/page-commands";
import {
  actionRows,
  emptySections,
  flattenSections,
  onPageLabel,
  onPageRows,
  searchSections,
  type PaletteRow,
  type PaletteSection,
} from "@/lib/palette/model";
import type { Resource } from "@/lib/permissions";
import { reachesResource } from "@/lib/permission-reach";
import { useAtMode, atScore } from "./use-at-mode";
import { useSlashMode } from "./use-slash-mode";
import { useDateMode } from "./use-date-mode";
import { useSearchMode } from "./use-search-mode";

export type Permissions = Partial<Record<Resource, readonly string[]>> | null;

/** The ONE "can open" rule (`src/lib/permission-reach.ts`), the shell's own. */
export const reaches = (p: Permissions, r: Resource) => reachesResource(p, r);

export interface Drill {
  parent: PaletteRow;
  rows: PaletteRow[];
}

/** Rows matching the drill filter, best first (the `@` scale). */
function filterDrill(rows: readonly PaletteRow[], text: string): PaletteRow[] {
  if (!text.trim()) return [...rows];
  return rows
    .map((row) => ({ row, s: atScore(row, text) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.row);
}

/** The empty state: Recent, `On #…` on a record page, then Actions (all gated). */
function useEmptyState(recent: PaletteRow[], permissions: Permissions) {
  const pathname = usePathname();
  const trail = useTrail();
  return useMemo((): PaletteSection[] => {
    const available = matchSlashCommands("", pathname, permissions);
    const label = onPageLabel(pathname, trail, extractEntityId(pathname));
    const pageRows = onPageRows(available);
    return emptySections({
      recent,
      onPage: label && pageRows.length > 0 ? { label, rows: pageRows } : null,
      actions: actionRows(available.filter((m) => !m.isPageSpecific), reaches(permissions, "warehouse")),
    });
  }, [recent, pathname, trail, permissions]);
}

/**
 * The highlighted row. It belongs to what the box says (`key`): a new query,
 * drill or toggle starts from `auto` (the `@` best match, else the top) until
 * the person moves it — so a late-landing `@` result can still move the
 * highlight, and nothing has to reset an index in an effect.
 */
function useSelection(key: string, auto: number) {
  const [sel, setSel] = useState<{ key: string; index: number } | null>(null);
  const index = sel && sel.key === key ? sel.index : auto;
  const setIndex = useCallback(
    (next: number | ((i: number) => number)) =>
      setSel((s) => {
        const from = s && s.key === key ? s.index : auto;
        return { key, index: typeof next === "function" ? next(from) : next };
      }),
    [key, auto],
  );
  return [index, setIndex] as const;
}

/** Which sections show, by mode: `/`, an `@` drill, a row drill, `@`, a date, empty, or search. */
function pickSections(m: {
  slash: PaletteSection[] | null;
  entity: PaletteSection[] | null;
  drill: PaletteSection[] | null;
  at: PaletteSection[] | null;
  date: PaletteSection[] | null;
  empty: PaletteSection[] | null;
  search: () => PaletteSection[];
}): PaletteSection[] {
  return m.slash ?? m.entity ?? m.drill ?? m.at ?? m.date ?? m.empty ?? m.search();
}

type Search = ReturnType<typeof useGlobalSearch>;

/** The input's own state: the query, a drill and its filter, the child toggle, expanded groups. */
function useInputState(initialQuery: string) {
  const [query, setQuery] = useState(initialQuery);
  const [showChildren, setShowChildren] = useState(true);
  const [expandedFamilies, setExpandedFamilies] = useState<ReadonlySet<string>>(new Set());
  const [drill, setDrill] = useState<Drill | null>(null);
  const [entityPage, setEntityPage] = useState<PageCommand | null>(null);
  const [drillQuery, setDrillQuery] = useState("");
  const drilling = drill !== null || entityPage !== null;
  return { query, setQuery, showChildren, setShowChildren, expandedFamilies, setExpandedFamilies, drill, setDrill, entityPage, setEntityPage, drillQuery, setDrillQuery, drilling };
}

type InputState = ReturnType<typeof useInputState>;

/** Every mode's reads, each idle unless the input is in that mode. */
function useModes(i: InputState, ctx: { orgId: string | undefined; permissions: Permissions; search: Search; now: number; pathname: string }) {
  const slash = useSlashMode(i.query, ctx.pathname, ctx.permissions, i.drilling);
  const at = useAtMode({ query: i.query, entityPage: i.entityPage, drillQuery: i.drillQuery, search: ctx.search });
  const date = useDateMode({
    raw: at.active ? at.atQuery : i.query,
    enabled: !i.drilling && !slash.active,
    now: ctx.now,
    orgId: ctx.orgId,
    canReadJobs: reaches(ctx.permissions, "project"),
    search: ctx.search,
  });
  // Plain search runs for any plain input, a date included: `14/11` lists that day's
  // jobs AND whatever the words match, so a date can never hide a search hit.
  const plain = !slash.active && !at.active && !i.drilling;
  const found = useSearchMode(ctx.search, i.query, plain);
  return { slash, at, date, plain, found, isEmpty: plain && i.query.trim().length < 2 };
}

type Modes = ReturnType<typeof useModes>;

/** The sections the current mode shows. */
function modeSections(i: InputState, m: Modes, empty: PaletteSection[]): PaletteSection[] {
  const dated = m.date.date ? m.date.sections : null;
  return pickSections({
    slash: m.slash.active ? m.slash.sections : null,
    entity: i.entityPage ? m.at.sections : null,
    drill: i.drill ? [{ key: "drill", label: null, rows: filterDrill(i.drill.rows, i.drillQuery) }] : null,
    at: m.at.active ? [...(dated ?? []), ...m.at.sections] : null,
    date: dated ? [...dated, ...searchSections(m.found.results, m.found.groups, i.query, i.expandedFamilies)] : null,
    empty: m.isEmpty ? empty : null,
    search: () => searchSections(m.found.results, m.found.groups, i.query, i.expandedFamilies),
  });
}

/** What the highlight belongs to, and where it starts (the `@` best match, past any date rows). */
function selectionOf(i: InputState, m: Modes): { key: string; auto: number } {
  const offset = m.at.active && m.date.date ? flattenSections(m.date.sections, false).length : 0;
  return {
    key: [i.query, i.drillQuery, i.entityPage?.href, i.drill?.parent.id, i.showChildren].join("\u0000"),
    auto: m.at.autoSelect === null ? 0 : m.at.autoSelect + offset,
  };
}

/** Every mode's state for one open palette; the body only renders it. */
export function usePaletteState({ orgId, userId, initialQuery }: { orgId: string | undefined; userId: string | undefined; initialQuery: string }) {
  const pathname = usePathname();
  const { permissions } = useCurrentRole();
  const search = useGlobalSearch();
  const now = useStableNow();
  const recents = usePaletteRecents(orgId, userId);
  const i = useInputState(initialQuery);
  const m = useModes(i, { orgId, permissions, search, now, pathname });
  const empty = useEmptyState(recents.rows, permissions);

  const sections = modeSections(i, m, empty);
  const rows = flattenSections(sections, i.showChildren && !i.drilling);
  const sel = selectionOf(i, m);
  const [selectedIndex, setSelectedIndex] = useSelection(sel.key, sel.auto);

  return {
    ...i,
    ...m,
    permissions,
    recents,
    sections,
    rows,
    selectedIndex,
    setSelectedIndex,
    hasKids: m.plain && sections.some((s) => s.rows.some((r) => !!r.children?.length)),
    loading: m.found.loading || m.at.loading || m.date.loading,
  };
}

export type PaletteState = ReturnType<typeof usePaletteState>;
