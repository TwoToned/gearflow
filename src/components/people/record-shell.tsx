"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { PageMeta } from "@/components/layout/page-meta";
import { DetailHeader, type DetailHeaderProps } from "@/components/ui/detail-header";
import { StatusWord } from "@/components/ui/status-word";
import { TabStrip, type TabStripItem } from "@/components/ui/tab-strip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { StatusValue } from "@/lib/primitives/types";

/**
 * The §4.2 record page shell (UX Phase 13, spec §9m.2), shared by Client, Supplier and
 * Supplier order (Crew joins it in slice 3): a `DetailHeader` (name, status word, one muted
 * identity line, `Edit` the one primary, ⋯ for the rest, red verbs last), controlled
 * underlined-word tabs with `?tab=` deep links (an unknown or panel-less key falls back to
 * Overview, the job-page rule), and a quiet context rail on every tab EXCEPT Overview (the
 * same facts Overview composes into its own columns, so nothing shows twice).
 */
export interface RecordTab extends TabStripItem {
  panel: React.ReactNode;
}

/** The tab to show: the `?tab=` value when a panel exists for it, else the first (Overview). */
export function resolveRecordTab(requested: string | null | undefined, tabs: { value: string }[]): string {
  return tabs.find((t) => t.value === requested)?.value ?? tabs[0]?.value ?? "overview";
}

export function useRecordTab(tabs: { value: string }[]): [string, (next: string) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const value = resolveRecordTab(params.get("tab"), tabs);
  const set = React.useCallback(
    (next: string) => {
      const p = new URLSearchParams(params.toString());
      if (next === tabs[0]?.value) p.delete("tab");
      else p.set("tab", next);
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, router, pathname, tabs],
  );
  return [value, set];
}

export function RecordShell({
  crumb,
  title,
  status,
  meta,
  banner,
  onEdit,
  menu,
  tabs,
  rail,
}: {
  /** The list this record lives in: `Clients › name` links back. */
  crumb: { label: string; href: string };
  title: string;
  status: StatusValue;
  meta: React.ReactNode[];
  /** One quiet strip above the tabs (Archived / Merged into…). */
  banner?: React.ReactNode;
  onEdit?: () => void;
  menu?: DetailHeaderProps["menu"];
  tabs: RecordTab[];
  rail?: React.ReactNode;
}) {
  const [tab, setTab] = useRecordTab(tabs);
  const active = tabs.find((t) => t.value === tab) ?? tabs[0];
  const showRail = !!rail && active.value !== tabs[0].value;
  return (
    <div className="flex flex-col gap-4">
      <PageMeta title={title} />
      <nav aria-label="Breadcrumb" className="text-caption text-muted">
        <Link href={crumb.href} className="hover:text-ink">
          {crumb.label}
        </Link>
        <span aria-hidden="true"> › </span>
        <span className="text-ink-2">{title}</span>
      </nav>
      <DetailHeader title={title} status={status} meta={meta} onEdit={onEdit} menu={menu} strip={banner} />
      <TabStrip items={tabs.map(({ panel: _panel, ...item }) => item)} value={active.value} onValueChange={setTab} idPrefix="rec" />
      <div className={cn("grid gap-8", showRail && "lg:grid-cols-[minmax(0,1fr)_260px]")} role="tabpanel" aria-labelledby={`rec-${active.value}`}>
        <div className="min-w-0">{active.panel}</div>
        {showRail ? <aside className="hidden text-table-cell text-ink-2 lg:block">{rail}</aside> : null}
      </div>
    </div>
  );
}

// ─── Calm building blocks (hairlines, words, no card chrome: playbook §3.9) ──────────

/** A small overline label above a block. */
export function Overline({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-badge font-semibold uppercase tracking-wide text-muted">{children}</div>;
}

/** The Overview's one headline: `$11,940 outstanding`, `On hire · 14 units`. */
export function Headline({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div>
      <p className="font-display text-[22px] font-extrabold leading-tight text-ink">{children}</p>
      {sub ? <p className="mt-0.5 text-table-cell text-muted">{sub}</p> : null}
    </div>
  );
}

export interface HealthItem {
  key: string;
  text: React.ReactNode;
  tone?: "error" | "warning" | "neutral";
  /** The muted `Action ›` that opens the thing that fixes it. */
  action?: { label: string; onSelect: () => void };
}

/** Health rows: only what needs a look, each with its one muted action. Nothing to show = one calm line. */
export function HealthRows({ items, allClear }: { items: HealthItem[]; allClear: string }) {
  if (items.length === 0) return <p className="text-table-cell text-muted">{allClear}</p>;
  return (
    <ul className="divide-y divide-line border-y border-line">
      {items.map((i) => (
        <li key={i.key} className="flex min-h-11 items-center gap-3 py-1.5">
          <span className={cn("size-1.5 shrink-0 rounded-full", i.tone === "error" ? "bg-t-out" : i.tone === "warning" ? "bg-warn" : "bg-faint")} aria-hidden="true" />
          <span className="min-w-0 flex-1 text-table-cell text-ink">{i.text}</span>
          {i.action ? (
            <Button variant="ghost" size="sm" className="text-muted" onClick={i.action.onSelect}>
              {i.action.label} ›
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Label / value facts in one column. A blank value is omitted, never `—`-filled. */
export function Facts({ title, facts }: { title: string; facts: { label: string; value: React.ReactNode }[] }) {
  const shown = facts.filter((f) => f.value != null && f.value !== "");
  return (
    <section aria-label={title}>
      <Overline>{title}</Overline>
      {shown.length === 0 ? <p className="text-table-cell text-muted">Nothing set.</p> : (
        <dl className="space-y-1 text-table-cell">
          {shown.map((f) => (
            <div key={f.label} className="flex gap-3">
              <dt className="w-28 shrink-0 text-muted">{f.label}</dt>
              <dd className="min-w-0 break-words text-ink">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export interface RecordRow {
  id: string;
  title: React.ReactNode;
  href?: string;
  meta?: React.ReactNode[];
  status?: StatusValue;
  trailing?: React.ReactNode;
}

/** A list tab: hairline rows, whole row opens, status as a dot-word, footer count. */
export function RecordRows({ rows, empty, noun }: { rows: RecordRow[]; empty: string; noun: string }) {
  if (rows.length === 0) return <p className="py-6 text-table-cell text-muted">{empty}</p>;
  return (
    <div>
      <ul className="divide-y divide-line border-y border-line">
        {rows.map((r) => (
          <li key={r.id} className="flex min-h-14 items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              {r.href ? (
                <Link href={r.href} className="block truncate font-medium text-ink hover:underline">
                  {r.title}
                </Link>
              ) : (
                <span className="block truncate font-medium text-ink">{r.title}</span>
              )}
              {r.meta?.length ? <div className="truncate text-caption text-muted">{r.meta.filter(Boolean).map((m, i) => <span key={i}>{i > 0 ? " · " : ""}{m}</span>)}</div> : null}
            </div>
            {r.status ? <StatusWord status={r.status} /> : null}
            {r.trailing}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-caption text-muted">
        {rows.length} {noun}
        {rows.length === 1 ? "" : "s"}
      </p>
    </div>
  );
}
