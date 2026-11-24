"use client";

import { useEffect, useMemo, useState } from "react";
import { matchPageCommands, type PageCommand, type MatchedPageCommand } from "@/lib/page-commands";
import { recordRow, type PaletteRow, type PaletteSection } from "@/lib/palette/model";
import type { SearchResult, SearchResultType } from "@/lib/search-types";
import type { GlobalSearchResponse } from "@/hooks/use-global-search";

/**
 * The palette's `@` mode, kept from the live palette (§6d.3): `@page` lists
 * pages, `@page words` also searches that page's records, and Tab on a
 * searchable page drills into its records (`entityPage`).
 */

type Search = (q: string) => Promise<GlobalSearchResponse>;

/** Which result types a searchable page's `searchType` covers. */
const ENTITY_TYPES: Record<string, SearchResultType[]> = {
  model: ["model"],
  asset: ["model", "asset", "bulk-asset", "kit"],
  kit: ["kit"],
  project: ["project"],
  client: ["client"],
  location: ["location"],
  maintenance: ["maintenance"],
  supplier: ["supplier"],
  crew: ["crew"],
  "check-item": ["check-item"],
  "group-template": ["group-template"],
  "sub-hire": ["sub-hire"],
};

const TYPE_WORDS: Partial<Record<SearchResultType, string>> = {
  model: "Model", kit: "Kit", asset: "Asset", "bulk-asset": "Bulk asset", project: "Job", client: "Client",
  supplier: "Supplier", location: "Location", category: "Category", maintenance: "Maintenance", crew: "Crew",
  "check-item": "Check item", "group-template": "Group template", "sub-hire": "Sub-hire",
};

/** One page's records for `q`, debounced, filtered to the page's types and statuses. */
function useEntitySearch(search: Search, q: string, page: PageCommand | null) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const searchType = page?.searchType ?? null;
  const statusFilter = page?.searchStatusFilter ?? null;
  useEffect(() => {
    if (!searchType || q.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const allowed = ENTITY_TYPES[searchType] ?? [];
    let aborted = false;
    const timer = setTimeout(() => {
      search(q)
        .then((data) => {
          if (aborted) return;
          setResults(data.results.filter((r) => allowed.includes(r.type) && (!statusFilter || !r.status || statusFilter.includes(r.status))));
        })
        .catch(() => !aborted && setResults([]))
        .finally(() => !aborted && setLoading(false));
    }, 200);
    return () => {
      aborted = true;
      clearTimeout(timer);
    };
  }, [search, q, searchType, statusFilter]);
  return { results, loading };
}

export function pageRow(cmd: PageCommand, isChild = false): PaletteRow {
  return {
    id: `page-${cmd.href}`,
    title: cmd.label,
    subtitle: cmd.description,
    icon: cmd.icon,
    href: cmd.href,
    isChild: isChild || undefined,
    hasChildren: !isChild && (!!cmd.children?.length || !!cmd.searchable),
  };
}

/** A page's record as a row, linked the way the page asks (`/warehouse/<id>?tab=…`). */
function entityRow(r: SearchResult, page: PageCommand): PaletteRow {
  const base = page.searchHrefPrefix ? `${page.searchHrefPrefix}/${r.id}` : r.href;
  return { ...recordRow(r), href: `${base}${page.searchHrefSuffix ?? ""}`, hint: r.isChild ? undefined : TYPE_WORDS[r.type] };
}

/** Pages (with their sub-pages) for `@words`, each listed once. */
function pageRows(matches: readonly MatchedPageCommand[]): PaletteRow[] {
  const shown = new Set<string>();
  const rows: PaletteRow[] = [];
  for (const { command } of matches) {
    for (const [cmd, child] of [[command, false], ...(command.children ?? []).map((c) => [c, true] as const)] as [PageCommand, boolean][]) {
      if (shown.has(cmd.href)) continue;
      shown.add(cmd.href);
      rows.push(pageRow(cmd, child));
    }
  }
  return rows;
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) if (hay[j] === needle[i]) i++;
  return i === needle.length;
}

const norm = (s: string) => s.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

interface AtText {
  nq: string;
  title: string;
  sub: string;
  words: string[];
}

/** The live palette's scale, best first: the first test a row passes is its score. */
const AT_SCALE: readonly [number, (t: AtText) => boolean][] = [
  [100, (t) => t.title === t.nq],
  [80, (t) => t.title.startsWith(t.nq)],
  [60, (t) => t.title.includes(t.nq)],
  [55, (t) => t.words.length > 1 && t.words.every((w) => t.title.includes(w) || t.sub.includes(w))],
  [40, (t) => t.sub.includes(t.nq)],
  [35, (t) => t.words.some((w) => t.title.includes(w))],
  [20, (t) => isSubsequence(t.nq, t.title)],
];

/** How well a row matches the words after `@page` (or a drill filter). 0 = not at all. */
export function atScore(row: PaletteRow, text: string): number {
  const t: AtText = {
    nq: norm(text),
    title: norm(`${row.mono ?? ""}${row.title}`),
    sub: norm(row.subtitle ?? ""),
    words: text.trim().toLowerCase().split(/\s+/).map(norm).filter(Boolean),
  };
  if (!t.nq) return 0;
  const hit = AT_SCALE.find(([, test]) => test(t));
  // Prefer a record over a sub-page link.
  return hit ? hit[0] + (row.id.startsWith("page-") ? 0 : 2) : 0;
}

/** The best row for `text`, never the page the command part already named. */
function bestIndex(rows: readonly PaletteRow[], text: string, parentId: string | null): number | null {
  if (!norm(text)) return null;
  let best: { i: number; s: number } | null = null;
  rows.forEach((row, i) => {
    if (row.id === parentId) return;
    const s = atScore(row, text);
    if (s > 0 && (!best || s > best.s)) best = { i, s };
  });
  return (best as { i: number; s: number } | null)?.i ?? null;
}

/**
 * `@page words` (2+ characters after the page): the page, its sub-pages, then
 * its matching records. Otherwise every matching page with its sub-pages.
 */
function atRows(matches: readonly MatchedPageCommand[], top: MatchedPageCommand | null, records: readonly SearchResult[]): PaletteRow[] {
  const text = top?.entityQuery ?? "";
  if (!top || text.length < 2) return pageRows(matches);
  const page = top.command;
  const children = (page.children ?? []).map((c) => pageRow(c, true));
  return [pageRow(page), ...children, ...(page.searchable ? records.map((r) => entityRow(r, page)) : [])];
}

/** The page a confident `@` match names (score ≥ 60), else null. */
const topMatch = (matches: readonly MatchedPageCommand[]) => (matches[0] && matches[0].score >= 60 ? matches[0] : null);

export function useAtMode({ query, entityPage, drillQuery, search }: { query: string; entityPage: PageCommand | null; drillQuery: string; search: Search }) {
  const active = query.startsWith("@") && !entityPage;
  const atQuery = active ? query.slice(1) : "";
  const matches = useMemo(() => (active ? matchPageCommands(atQuery) : []), [active, atQuery]);
  const top = topMatch(matches);
  const entityText = top?.entityQuery ?? "";

  const inline = useEntitySearch(search, entityText, top?.command.searchable ? top.command : null);
  const drill = useEntitySearch(search, entityPage ? drillQuery : "", entityPage);

  const rows = useMemo(() => (active ? atRows(matches, top, inline.results) : []), [active, matches, top, inline.results]);
  const drillRows = useMemo(
    () => (entityPage && drillQuery.length >= 2 ? drill.results.map((r) => ({ ...entityRow(r, entityPage), hint: undefined })) : []),
    [entityPage, drillQuery, drill.results],
  );
  const autoSelect = useMemo(() => (entityText ? bestIndex(rows, entityText, top ? `page-${top.command.href}` : null) : null), [entityText, rows, top]);

  const sections: PaletteSection[] = [entityPage ? { key: "at-entity", label: null, rows: drillRows } : { key: "at", label: null, rows }];
  return { active, atQuery, matches, sections, loading: inline.loading || drill.loading, autoSelect };
}
