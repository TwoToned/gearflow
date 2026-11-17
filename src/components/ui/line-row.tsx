"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";

import { ActionMenu } from "@/components/ui/action-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { StateGlyphs } from "@/components/ui/state-glyph";
import { StatusWord } from "@/components/ui/status-word";
import { useIsMobile } from "@/hooks/use-mobile";
import { factText, splitPhoneFacts } from "@/lib/primitives/facts";
import type { Fact, FactColumn, LineRowData, LineRowSectionData, RowFlag, RowSelection } from "@/lib/primitives/types";
import { intentStyles } from "@/lib/status-colors";
import { cn } from "@/lib/utils";

/**
 * The one row (UX unification §5.1). Desktop: a `<tr>`; the parent picks the
 * fact columns. Phone: a 60-64 px card with facts folded into the subtitle,
 * the first qty/money fact on the right, a 22 px checkbox and an always-visible
 * 40 px ⋯ (D39). One level of 44 px children with no actions. Whole row opens;
 * calm language: hairlines, no card chrome, flags as dot-words, tags muted.
 *
 * Render rows inside `<LineRowList>`, which supplies the table (desktop) or
 * the list (phone) and the select-page header.
 */

const INTERACTIVE = "button, a, input, [role='checkbox'], [role='menu'], [data-no-open]";

/** Wraps a row's main element (the `<tr>` / the phone card) so a caller can attach behaviour (e.g. a sortable ref). Generic: no library in the primitive. */
export type WrapRow = (row: LineRowData, rowEl: React.ReactElement) => React.ReactElement;

interface RowProps {
  row: LineRowData;
  columns: FactColumn[];
  selection?: RowSelection;
  wrapRow?: WrapRow;
  /** Desktop only: rendered in the select cell, before the checkbox. */
  dragHandle?: (row: LineRowData) => React.ReactNode;
}

function FlagWord({ flag }: { flag: RowFlag }) {
  const styles = intentStyles[flag.tone];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-caption font-medium", styles.text)}>
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", styles.dot)} />
      {flag.label}
    </span>
  );
}

function Tags({ tags }: { tags?: string[] }) {
  if (!tags?.length) return null;
  return <span className="t-mono text-muted">· {tags.join(" · ")}</span>;
}

function Title({ row, linkRef }: { row: LineRowData; linkRef: React.Ref<HTMLAnchorElement> }) {
  const cls = "min-w-0 truncate text-ui-text font-medium text-ink";
  return row.href ? (
    <Link ref={linkRef} href={row.href} className={cn(cls, "outline-none focus-visible:underline")}>
      {row.title}
    </Link>
  ) : (
    <span className={cls}>{row.title}</span>
  );
}

/** Opens the row when the click lands on the row itself, not a control inside it. */
function useWholeRowOpen(row: LineRowData) {
  const linkRef = React.useRef<HTMLAnchorElement>(null);
  const open = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    if (row.onOpen) row.onOpen();
    else linkRef.current?.click();
  };
  return { linkRef, open, openable: !!(row.onOpen || row.href) };
}

function SelectBox({ row, selection, size }: { row: LineRowData; selection: RowSelection; size: "sm" | "lg" }) {
  return (
    <Checkbox
      aria-label={`Select ${row.title}`}
      checked={selection.isSelected(row.id)}
      // Radix fires onCheckedChange without the event, so read shift from the click.
      onClick={(e) => {
        e.preventDefault();
        selection.toggle(row.id, { shift: e.shiftKey });
      }}
      className={size === "lg" ? "[&>span]:size-[22px]" : undefined}
    />
  );
}

function ExpandToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      aria-label={open ? "Collapse" : "Expand"}
      aria-expanded={open}
      onClick={onToggle}
      className="grid size-6 shrink-0 place-items-center text-muted hover:text-ink"
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}

/** A column's cell: the caller's override, else the status word, else the typed fact. */
function Cell({ row, id }: { row: LineRowData; id: string }) {
  if (row.cells?.[id] != null) return <>{row.cells[id]}</>;
  if (id === "status" && row.status) return <StatusWord status={row.status} />;
  return <FactBody fact={row.facts[id]} />;
}

function FactBody({ fact }: { fact?: Fact }) {
  if (!fact) return null;
  const right = fact.kind === "qty" || fact.kind === "money";
  const warn = fact.kind === "availability" && fact.state === "short";
  return (
    <span className={cn("text-table-cell", right && "font-mono tabular-nums", warn ? "text-t-out" : "text-ink-2")}>
      {factText(fact)}
    </span>
  );
}

/** `primary` is sanctioned for accessory rows only (§9.5); ignored (dev warning) elsewhere. */
function allowedPrimary(row: LineRowData): LineRowData["primary"] {
  if (!row.primary) return undefined;
  if (row.kind === "accessory") return row.primary;
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console -- dev-only guard for a rejected pattern
    console.warn(`LineRow: ignoring \`primary\` on a "${row.kind}" row; it is only for accessory rows (playbook §10).`);
  }
  return undefined;
}

/** A child has no actions, except an accessory row: its quiet text button and ⋯. */
function ChildActions({ child }: { child: LineRowData }) {
  const primary = allowedPrimary(child); // also warns on a misplaced `primary`
  if (child.kind !== "accessory") return null;
  return (
    <span className="inline-flex items-center justify-end gap-1">
      {primary && (
        <button type="button" onClick={() => void primary.onSelect()} className="min-h-11 px-2 text-caption font-medium text-ink-2 hover:text-ink">
          {primary.label}
        </button>
      )}
      {child.menu && <ActionMenu spec={child.menu} label={`${child.title} actions`} />}
    </span>
  );
}

function ChildDesktop({ child, columns, span }: { child: LineRowData; columns: FactColumn[]; span: number }) {
  return (
    <tr data-child-row className="h-11 bg-paper-2/40">
      <td />
      <td className="pl-8 text-table-cell text-ink-2">
        <span className="font-medium">{child.title}</span>
        {child.subtitle && <span className="ml-2 text-muted">{child.subtitle}</span>}
        <Tags tags={child.tags} />
      </td>
      {columns.map((c) => (
        <td key={c.id} className={cn("px-2", c.align === "end" && "text-right")}>
          <Cell row={child} id={c.id} />
        </td>
      ))}
      <td colSpan={Math.max(span - columns.length - 2, 1)} className="px-1 text-right">
        <ChildActions child={child} />
      </td>
    </tr>
  );
}

function applyWrap(wrap: WrapRow | undefined, row: LineRowData, el: React.ReactElement): React.ReactElement {
  return wrap ? wrap(row, el) : el;
}

function MaybeSelect({ row, selection, size }: { row: LineRowData; selection?: RowSelection; size: "sm" | "lg" }) {
  return selection && row.selectable !== false ? <SelectBox row={row} selection={selection} size={size} /> : null;
}

function DesktopRow({ row, columns, selection, wrapRow, dragHandle }: RowProps) {
  const [expanded, setExpanded] = React.useState(false);
  const { linkRef, open, openable } = useWholeRowOpen(row);
  const hasChildren = !!row.children?.length;
  const tr = (
      <tr
        data-row-id={row.id}
        onClick={open}
        className={cn("group/row h-12 border-t border-line hover:bg-elev", openable && "cursor-pointer")}
      >
        <td className="w-11 px-1">
          <span className="inline-flex items-center">
            {dragHandle?.(row)}
            <MaybeSelect row={row} selection={selection} size="sm" />
          </span>
        </td>
        <td className="min-w-0 py-1.5 pr-3">
          <div className="flex min-w-0 items-center gap-2">
            {hasChildren && <ExpandToggle open={expanded} onToggle={() => setExpanded((v) => !v)} />}
            <Title row={row} linkRef={linkRef} />
            {row.flags?.map((f) => <FlagWord key={f.label} flag={f} />)}
            <StateGlyphs glyphs={row.glyphs} />
            <Tags tags={row.tags} />
          </div>
          {row.subtitle && <div className="truncate text-caption text-muted">{row.subtitle}</div>}
        </td>
        {columns.map((c) => (
          <td key={c.id} className={cn("px-2", c.align === "end" && "text-right")}>
            <Cell row={row} id={c.id} />
          </td>
        ))}
        <td className="w-11 px-1 text-right">{row.menu && <ActionMenu spec={row.menu} label={`${row.title} actions`} />}</td>
      </tr>
  );
  return (
    <>
      {applyWrap(wrapRow, row, tr)}
      {expanded && row.children?.map((c) => <ChildDesktop key={c.id} child={c} columns={columns} span={columns.length + 3} />)}
    </>
  );
}

function PhoneChild({ child }: { child: LineRowData }) {
  return (
    <div data-child-row className="flex min-h-11 items-center gap-2 bg-paper-2/40 py-1 pl-12 pr-3 text-table-cell text-ink-2">
      <span className="min-w-0 flex-1 truncate">{child.title}</span>
      {Object.values(child.facts)
        .slice(0, 1)
        .map((f) => (
          <FactBody key={f.kind} fact={f} />
        ))}
      {child.status && child.kind === "accessory" && <StatusWord status={child.status} />}
      <ChildActions child={child} />
    </div>
  );
}

function TitleLine({ row, linkRef }: { row: LineRowData; linkRef: React.Ref<HTMLAnchorElement> }) {
  return (
    <>
      <Title row={row} linkRef={linkRef} />
      {row.flags?.map((f) => <FlagWord key={f.label} flag={f} />)}
      <StateGlyphs glyphs={row.glyphs} />
    </>
  );
}

function phoneSubtitle(subtitle: string | undefined, folded: Fact[]): string {
  return [subtitle, ...folded.map(factText)].filter(Boolean).join(" · ");
}

function PhoneRow({ row, columns, selection, wrapRow }: RowProps) {
  const [expanded, setExpanded] = React.useState(false);
  const { linkRef, open, openable } = useWholeRowOpen(row);
  const { right, folded } = splitPhoneFacts(columns.map((c) => c.id), row.facts);
  const sub = phoneSubtitle(row.subtitle, folded);
  const hasChildren = !!row.children?.length;
  const card = (
    <div data-row-id={row.id} className="border-t border-line">
      <div
        onClick={open}
        className={cn("flex min-h-[62px] items-center gap-1 pl-1 pr-1", openable && "cursor-pointer")}
      >
        <MaybeSelect row={row} selection={selection} size="lg" />
        {hasChildren && <ExpandToggle open={expanded} onToggle={() => setExpanded((v) => !v)} />}
        <div className="min-w-0 flex-1 py-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <TitleLine row={row} linkRef={linkRef} />
          </div>
          {sub && <div className="truncate text-caption text-muted">{sub}</div>}
        </div>
        {right && <FactBody fact={right} />}
        {row.menu && <ActionMenu spec={row.menu} label={`${row.title} actions`} />}
      </div>
      {expanded && row.children?.map((c) => <PhoneChild key={c.id} child={c} />)}
    </div>
  );
  return applyWrap(wrapRow, row, card);
}

function LineRow(props: RowProps) {
  return useIsMobile() ? <PhoneRow {...props} /> : <DesktopRow {...props} />;
}

/** One section of a sectioned list: its head data and the rows that follow it. */
export interface LineRowListSection {
  section: LineRowSectionData;
  rows: LineRowData[];
  /**
   * Rows with NO head: they continue the previous section's block (e.g. loose
   * lines that sit after a nested group in a user-ordered list). `section`
   * only supplies the id; collapse is the caller's (omit the rows to hide them).
   */
  headless?: boolean;
  /** Controlled collapse; omit for list-owned state (`defaultCollapsed` is false). */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

/**
 * Ids of the rows a user can see, in DOM order: pass this to `useRowSelection`
 * so shift-range and select-page skip rows hidden by a collapsed section and
 * rows with `selectable: false` (they render no checkbox).
 * `collapsedIds` is only needed for sections whose collapse the list owns
 * (i.e. no `collapsed` given); controlled sections use their own flag.
 */
export function visibleRowIds(sections: LineRowListSection[], collapsedIds?: ReadonlySet<string>): string[] {
  return sections.flatMap((s) => ((s.collapsed ?? collapsedIds?.has(s.section.id)) ? [] : s.rows.filter((r) => r.selectable !== false).map((r) => r.id)));
}

interface ListShared {
  columns: FactColumn[];
  selection?: RowSelection;
  className?: string;
  wrapRow?: WrapRow;
  dragHandle?: (row: LineRowData) => React.ReactNode;
  wrapSection?: (el: React.ReactElement) => React.ReactElement;
}

/** Flat `rows` XOR grouped `sections` (mutually exclusive). */
export type LineRowListProps = ListShared &
  ({ rows: LineRowData[]; sections?: never } | { sections: LineRowListSection[]; rows?: never });

function ListBody(props: LineRowListProps) {
  const { columns, selection, wrapRow, dragHandle, wrapSection } = props;
  const [owned, setOwned] = React.useState<ReadonlySet<string>>(() => new Set());
  const rowEl = (r: LineRowData) => (
    <LineRow key={r.id} row={r} columns={columns} selection={selection} wrapRow={wrapRow} dragHandle={dragHandle} />
  );
  if (!props.sections) return <>{props.rows.map(rowEl)}</>;
  return (
    <>
      {props.sections.map((s) => {
        if (s.headless) return <React.Fragment key={s.section.id}>{s.rows.map(rowEl)}</React.Fragment>;
        const collapsed = s.collapsed ?? owned.has(s.section.id);
        return (
          <React.Fragment key={s.section.id}>
            <LineRowSection
              section={s.section}
              columns={columns}
              collapsed={collapsed}
              wrapSection={wrapSection}
              onCollapsedChange={(c) => {
                setOwned((prev) => {
                  const next = new Set(prev);
                  if (c) next.add(s.section.id);
                  else next.delete(s.section.id);
                  return next;
                });
                s.onCollapsedChange?.(c);
              }}
            />
            {!collapsed && s.rows.map(rowEl)}
          </React.Fragment>
        );
      })}
    </>
  );
}

/**
 * The list: ONE table with ONE header (select-page box on desktop) or a plain
 * list on phone. Pass flat `rows`, or `sections` (each a `LineRowSection` head
 * followed by its rows in the same `<tbody>`; collapsed sections hide their
 * rows). Selection covers the VISIBLE rows in DOM order: derive the ids you
 * give `useRowSelection` with `visibleRowIds`.
 */
export function LineRowList(props: LineRowListProps) {
  const { columns, selection, className } = props;
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <div className={className}>
        <ListBody {...props} />
      </div>
    );
  }
  return (
    <table className={cn("w-full border-collapse", className)}>
      <thead>
        <tr className="h-9 text-left text-badge font-semibold text-muted">
          <th className="w-11 px-1">
            {selection && (
              <Checkbox
                aria-label="Select page"
                checked={selection.pageState === "all" ? true : selection.pageState === "some" ? "indeterminate" : false}
                onCheckedChange={() => selection.togglePage()}
              />
            )}
          </th>
          <th className="font-semibold">Item</th>
          {columns.map((c) => (
            <th key={c.id} className={cn("px-2 font-semibold", c.align === "end" && "text-right")}>
              {c.header}
            </th>
          ))}
          <th className="w-11" />
        </tr>
      </thead>
      <tbody>
        <ListBody {...props} />
      </tbody>
    </table>
  );
}

function SectionHead({
  section,
  collapsed,
  onToggle,
  withCells,
}: {
  section: LineRowSectionData;
  collapsed: boolean;
  onToggle: () => void;
  /** Column mode: the amount and ⋯ live in their own cells, not in the head. */
  withCells?: boolean;
}) {
  return (
    <div className={cn("flex min-h-11 w-full items-center gap-2 px-1", section.depth === 1 && "pl-6")}>
      {section.selectState && <SectionBox section={section} />}
      <ExpandToggle open={!collapsed} onToggle={onToggle} />
      <span className="min-w-0 truncate text-ui-text font-semibold text-ink">{section.title}</span>
      {section.count != null && <span className="t-mono text-muted">{section.count}</span>}
      {section.flags?.map((f) => <FlagWord key={f.label} flag={f} />)}
      <span className="flex-1" />
      {!withCells && section.amount !== undefined && <FactBody fact={{ kind: "money", amount: section.amount }} />}
      {!withCells && section.menu && <ActionMenu spec={section.menu} label={`${section.title} actions`} />}
    </div>
  );
}

/** Desktop head in column mode: one `<tr>`, the head across select+item, then a cell per column. */
function sectionCellsRow({
  section,
  columns,
  head,
}: {
  section: LineRowSectionData;
  columns: FactColumn[];
  head: React.ReactNode;
}) {
  return (
    <tr data-section-id={section.id} data-depth={section.depth ?? 0} className={sectionBand(section)}>
      <td colSpan={2} className="p-0">
        {head}
      </td>
      {columns.map((c) => (
        <td key={c.id} className={cn("px-2", c.align === "end" && "text-right")}>
          {section.cells?.[c.id]}
        </td>
      ))}
      <td className="w-11 px-1 text-right">
        {section.menu && <ActionMenu spec={section.menu} label={`${section.title} actions`} />}
      </td>
    </tr>
  );
}

function sectionBand(section: LineRowSectionData): string {
  return cn("border-t border-line", section.depth === 1 ? "bg-paper-2/20" : "bg-paper-2/40");
}

function SectionBox({ section }: { section: LineRowSectionData }) {
  const state = section.selectState;
  return (
    <Checkbox
      aria-label={`Select all in ${section.title}`}
      checked={state === "all" ? true : state === "some" ? "indeterminate" : false}
      onCheckedChange={() => section.onToggleSelect?.()}
    />
  );
}

/**
 * A section head (category / case / group) beside `LineRowList`: title, mono
 * count, derived subtotal, flag dot-words, optional ⋯, collapse toggle and an
 * optional tri-state "tick all" box. Render it as a sibling before the
 * section's rows; hide the rows when `collapsed`. Desktop: a full-width `<tr>`
 * (put it in the same `<tbody>`, so pass `columns` for the span); phone: a
 * hairline head. `wrapSection` lets a caller attach a droppable (generic, no
 * library here). Collapse is uncontrolled unless `collapsed` is given.
 */
export function LineRowSection({
  section,
  columns,
  collapsed,
  defaultCollapsed = false,
  onCollapsedChange,
  wrapSection,
}: {
  section: LineRowSectionData;
  columns: FactColumn[];
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  wrapSection?: (el: React.ReactElement) => React.ReactElement;
}) {
  const isMobile = useIsMobile();
  const [inner, setInner] = React.useState(defaultCollapsed);
  const isCollapsed = collapsed ?? inner;
  const toggle = () => {
    setInner(!isCollapsed);
    onCollapsedChange?.(!isCollapsed);
  };
  const withCells = !isMobile && !!section.cells && Object.keys(section.cells).length > 0;
  const head = <SectionHead section={section} collapsed={isCollapsed} onToggle={toggle} withCells={withCells} />;
  if (isMobile) {
    const el = <div data-section-id={section.id} className={sectionBand(section)}>{head}</div>;
    return wrapSection ? wrapSection(el) : el;
  }
  const tr = withCells ? (
    sectionCellsRow({ section, columns, head })
  ) : (
    <tr data-section-id={section.id} data-depth={section.depth ?? 0} className={sectionBand(section)}>
      <td colSpan={columns.length + 3} className="p-0">
        {head}
      </td>
    </tr>
  );
  return wrapSection ? wrapSection(tr) : tr;
}
