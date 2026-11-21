"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ChevronDown, Search, X } from "lucide-react";

import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { TabStrip } from "@/components/ui/tab-strip";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { cn } from "@/lib/utils";

/**
 * The parts of `ListPage` (UX unification §9b): head, toolbar, filter word,
 * footer, empty state. Split so each stays a few branches; `ListPage` composes
 * them and owns the URL state and selection. Calm language: words, hairlines,
 * no filled pills; the one primary is a red `Button`.
 */

export interface ListSegment {
  key: string;
  label: string;
  /** Muted after the word; omit while loading. */
  count?: number;
}

interface FilterOption {
  value: string;
  label: string;
}

export interface ListFilterDef {
  key: string;
  label: string;
  options: FilterOption[];
  /** One value at a time (Dates presets): choosing replaces, choosing it again clears. */
  single?: boolean;
  /** Name search inside the popover for long lists (clients, models). */
  search?: { value: string; onChange: (v: string) => void; placeholder: string };
}

export interface ListPrimary {
  label: string;
  onSelect: () => void;
}

// ─── Head ────────────────────────────────────────────────────────────────

/** One page-level view word in the head (`Planner  Timesheets`, §9h.2): a route, not a list param. */
export interface HeadWord {
  key: string;
  label: string;
  href: string;
}

/** The head's view words and which one this page is. */
export interface HeadWords {
  words: HeadWord[];
  value: string;
}

/**
 * Page-level view words (Jobs' `Table  Board` position, §9h.2). Each word is a
 * link to its own route, so a deep link and Back keep working; the current one
 * is ink with the red underline. Desktop: in the head before ⋯ and the primary.
 * Phone: its own row under the title (44 px targets).
 */
function HeadWordLinks({ headWords }: { headWords: HeadWords }) {
  return (
    <nav aria-label="Views" className="flex items-center gap-4">
      {headWords.words.map((w) => {
        const on = w.key === headWords.value;
        return (
          <Link
            key={w.key}
            href={w.href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center border-b-2 text-ui-text font-medium md:min-h-9",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red",
              on ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {w.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function ListHead({
  title,
  primary,
  pageMenu,
  headWords,
}: {
  title: string;
  primary?: ListPrimary;
  pageMenu?: ActionMenuSpec;
  /** Additive (UX Phase 15, Q-I2): page-level view words, each its own route. */
  headWords?: HeadWords;
}) {
  const isMobile = useIsMobile();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-11 items-center gap-2">
        <h1 className="flex-1 text-page-title font-semibold text-ink">{title}</h1>
        {headWords && !isMobile && <HeadWordLinks headWords={headWords} />}
        {pageMenu && pageMenu.items.length > 0 && <ActionMenu spec={pageMenu} label={`${title} options`} />}
        {primary && !isMobile && (
          <Button size="sm" onClick={primary.onSelect}>
            {primary.label}
          </Button>
        )}
      </div>
      {headWords && isMobile && <HeadWordLinks headWords={headWords} />}
    </div>
  );
}

export function ListSegments({
  segments,
  value,
  onChange,
}: {
  segments: ListSegment[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <TabStrip
      aria-label="Segments"
      idPrefix="seg"
      value={value}
      onValueChange={onChange}
      items={segments.map((s) => ({ value: s.key, label: s.label, count: s.count }))}
    />
  );
}

// ─── Filter word ─────────────────────────────────────────────────────────

/** `Status` when idle; `Status: Booked` or `Status: 2 chosen` once something is picked. */
function filterWordLabel(def: ListFilterDef, chosen: string[]): string {
  if (chosen.length === 0) return def.label;
  if (chosen.length > 1) return `${def.label}: ${chosen.length} chosen`;
  const opt = def.options.find((o) => o.value === chosen[0]);
  return `${def.label}: ${opt?.label ?? chosen[0]}`;
}

function OptionRow({ option, checked, onToggle }: { option: FilterOption; checked: boolean; onToggle: () => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-1 text-ui-text text-ink hover:bg-paper-2">
      <Checkbox aria-label={option.label} checked={checked} onCheckedChange={onToggle} />
      <span className="min-w-0 flex-1 truncate">{option.label}</span>
    </label>
  );
}

function FilterSearch({ search }: { search: NonNullable<ListFilterDef["search"]> }) {
  return (
    <Input
      aria-label={search.placeholder}
      placeholder={search.placeholder}
      value={search.value}
      onChange={(e) => search.onChange(e.target.value)}
      className="mb-2 h-9 text-base md:text-ui-text"
    />
  );
}

/**
 * One filter as a word that opens a multi-select (Radix Popover, never a Base UI
 * popup). Chosen values print in the word with a ✕ beside it that clears just
 * this filter.
 */
export function FilterWord({
  def,
  chosen,
  onChange,
}: {
  def: ListFilterDef;
  chosen: string[];
  onChange: (values: string[]) => void;
}) {
  const active = chosen.length > 0;
  const toggle = (value: string) => {
    if (def.single) return onChange(chosen.includes(value) ? [] : [value]);
    onChange(chosen.includes(value) ? chosen.filter((v) => v !== value) : [...chosen, value]);
  };
  return (
    <span className="inline-flex shrink-0 items-center">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex min-h-11 items-center gap-1 whitespace-nowrap rounded text-ui-text hover:text-ink md:min-h-9",
              active ? "font-medium text-ink" : "text-ink-2",
            )}
          >
            {filterWordLabel(def, chosen)}
            <ChevronDown className="size-3.5 text-muted" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="max-h-80 w-64 overflow-y-auto p-2">
          {def.search && <FilterSearch search={def.search} />}
          {def.options.length === 0 && <p className="px-1 py-2 text-caption text-muted">No options</p>}
          {def.options.map((o) => (
            <OptionRow key={o.value} option={o} checked={chosen.includes(o.value)} onToggle={() => toggle(o.value)} />
          ))}
        </PopoverContent>
      </Popover>
      {active && (
        <button
          type="button"
          aria-label={`Clear ${def.label}`}
          onClick={() => onChange([])}
          className="grid size-11 place-items-center text-muted hover:text-ink md:size-9"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

// ─── Toolbar ─────────────────────────────────────────────────────────────

export interface ViewWord {
  key: string;
  label: string;
}

function ViewWords({ views, value, onChange }: { views: ViewWord[]; value: string; onChange: (key: string) => void }) {
  return (
    <span role="group" aria-label="View" className="inline-flex items-center gap-1">
      {views.map((v, i) => (
        <React.Fragment key={v.key}>
          {i > 0 && <span aria-hidden="true" className="text-muted">·</span>}
          <button
            type="button"
            aria-pressed={v.key === value}
            onClick={() => onChange(v.key)}
            className={cn("min-h-11 px-1 text-ui-text md:min-h-9", v.key === value ? "font-medium text-ink" : "text-muted hover:text-ink")}
          >
            {v.label}
          </button>
        </React.Fragment>
      ))}
    </span>
  );
}

export function ListToolbar({
  search,
  onSearch,
  placeholder,
  filters,
  chosen,
  onFilter,
  canClear,
  onClear,
  views,
  view,
  onView,
  extra,
}: {
  search: string;
  onSearch: (q: string) => void;
  placeholder: string;
  filters: ListFilterDef[];
  chosen: Record<string, string[]>;
  onFilter: (key: string, values: string[]) => void;
  canClear: boolean;
  onClear: () => void;
  views?: ViewWord[];
  view: string;
  onView: (key: string) => void;
  /** Trailing slot: the saved-views menu. */
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 md:flex-row md:items-center md:gap-3">
      <div className="relative md:w-72">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <Input
          type="search"
          aria-label="Search"
          placeholder={placeholder}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="h-11 pl-9 text-base md:h-9 md:text-ui-text"
        />
      </div>
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto md:flex-1 md:overflow-visible">
        {filters.map((f) => (
          <FilterWord key={f.key} def={f} chosen={chosen[f.key] ?? []} onChange={(v) => onFilter(f.key, v)} />
        ))}
        {canClear && (
          <button type="button" onClick={onClear} className="min-h-11 shrink-0 text-ui-text text-muted hover:text-ink md:min-h-9">
            Clear filters
          </button>
        )}
      </div>
      <div className="flex items-center gap-3">
        {views && views.length > 1 && <ViewWords views={views} value={view} onChange={onView} />}
        {extra}
      </div>
    </div>
  );
}

// ─── Footer ──────────────────────────────────────────────────────────────

function pageRange(total: number, page: number, pageSize: number): { from: number; to: number; pages: number } {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  return { from, to: Math.min(total, page * pageSize), pages };
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        aria-label="Previous page"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className="grid size-9 place-items-center text-muted hover:text-ink disabled:opacity-40"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </button>
      <span className="t-mono tabular-nums text-ink-2">
        {page} / {pages}
      </span>
      <button
        type="button"
        aria-label="Next page"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
        className="grid size-9 place-items-center text-muted hover:text-ink disabled:opacity-40"
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </button>
    </span>
  );
}

/**
 * Desktop: `38 jobs · 1–25 ‹ 1 / 2 ›`. Phone: `Showing 25 of 38` and a
 * `Show 25 more` button (the page accumulates rows; no pager).
 */
export function ListFooter({
  total,
  page,
  pageSize,
  shown,
  noun,
  onPage,
}: {
  total: number;
  page: number;
  pageSize: number;
  /** Phone: rows currently on screen (accumulated). */
  shown: number;
  /** Plural noun: "jobs". */
  noun: string;
  onPage: (p: number) => void;
}) {
  const isMobile = useIsMobile();
  const { from, to, pages } = pageRange(total, page, pageSize);
  if (total === 0) return null;
  const word = total === 1 ? noun.replace(/s$/, "") : noun;
  if (isMobile) {
    const more = Math.min(pageSize, total - shown);
    return (
      <div className="flex flex-col items-center gap-1 py-3 text-caption text-muted">
        <span>
          Showing {shown} of {total} {word}
        </span>
        {more > 0 && (
          <Button variant="line" size="sm" onClick={() => onPage(page + 1)}>
            Show {more} more
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between border-t border-line py-2 text-caption text-muted">
      <span>
        {total} {word} · {from}–{to}
      </span>
      {pages > 1 && <Pager page={page} pages={pages} onPage={onPage} />}
    </div>
  );
}

// ─── Empty and loading ───────────────────────────────────────────────────

export interface ListEmptyCopy {
  title: string;
  description?: string;
  /** The next action when nothing exists yet. */
  action?: ListPrimary;
}

/** "None yet" says what to do next; "nothing matches" offers Clear filters. */
export function ListEmpty({
  filtered,
  none,
  onClear,
}: {
  filtered: boolean;
  none: ListEmptyCopy;
  onClear: () => void;
}) {
  if (filtered) {
    return (
      <EmptyState
        title="Nothing matches"
        description="Try a different search or loosen the filters."
        action={
          <Button variant="line" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        }
      />
    );
  }
  return (
    <EmptyState
      title={none.title}
      description={none.description}
      action={
        none.action ? (
          <Button size="sm" onClick={none.action.onSelect}>
            {none.action.label}
          </Button>
        ) : undefined
      }
    />
  );
}

export function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
