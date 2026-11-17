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
import type { Fact, FactColumn, LineRowData, RowFlag, RowSelection } from "@/lib/primitives/types";
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

interface RowProps {
  row: LineRowData;
  columns: FactColumn[];
  selection?: RowSelection;
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
          {c.id === "status" && child.status ? <StatusWord status={child.status} /> : <FactBody fact={child.facts[c.id]} />}
        </td>
      ))}
      <td colSpan={Math.max(span - columns.length - 2, 1)} className="px-1 text-right">
        <ChildActions child={child} />
      </td>
    </tr>
  );
}

function DesktopRow({ row, columns, selection }: RowProps) {
  const [expanded, setExpanded] = React.useState(false);
  const { linkRef, open, openable } = useWholeRowOpen(row);
  const hasChildren = !!row.children?.length;
  return (
    <>
      <tr
        data-row-id={row.id}
        onClick={open}
        className={cn("group/row h-12 border-t border-line hover:bg-elev", openable && "cursor-pointer")}
      >
        <td className="w-11 px-1">{selection && <SelectBox row={row} selection={selection} size="sm" />}</td>
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
            {c.id === "status" && row.status ? <StatusWord status={row.status} /> : <FactBody fact={row.facts[c.id]} />}
          </td>
        ))}
        <td className="w-11 px-1 text-right">{row.menu && <ActionMenu spec={row.menu} label={`${row.title} actions`} />}</td>
      </tr>
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

function PhoneRow({ row, columns, selection }: RowProps) {
  const [expanded, setExpanded] = React.useState(false);
  const { linkRef, open, openable } = useWholeRowOpen(row);
  const { right, folded } = splitPhoneFacts(columns.map((c) => c.id), row.facts);
  const sub = phoneSubtitle(row.subtitle, folded);
  const hasChildren = !!row.children?.length;
  return (
    <div data-row-id={row.id} className="border-t border-line">
      <div
        onClick={open}
        className={cn("flex min-h-[62px] items-center gap-1 pl-1 pr-1", openable && "cursor-pointer")}
      >
        {selection && <SelectBox row={row} selection={selection} size="lg" />}
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
}

function LineRow(props: RowProps) {
  return useIsMobile() ? <PhoneRow {...props} /> : <DesktopRow {...props} />;
}

/** The list: table + header with the select-page box on desktop, plain list on phone. */
export function LineRowList({
  rows,
  columns,
  selection,
  className,
}: {
  rows: LineRowData[];
  columns: FactColumn[];
  selection?: RowSelection;
  className?: string;
}) {
  const isMobile = useIsMobile();
  const body = rows.map((r) => <LineRow key={r.id} row={r} columns={columns} selection={selection} />);
  if (isMobile) return <div className={className}>{body}</div>;
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
      <tbody>{body}</tbody>
    </table>
  );
}
