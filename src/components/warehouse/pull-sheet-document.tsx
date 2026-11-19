"use client";

import { Square, Container } from "lucide-react";
import { formatDate } from "@/lib/formatters";
import type { PullRow } from "@/lib/pdfme/pull-list";
import { cn } from "@/lib/utils";

export interface PullSheetData {
  project: {
    id: string;
    projectNumber: string;
    name: string;
    status: string;
    clientName: string | null;
    rentalStartDate: string | Date | null;
    rentalEndDate: string | Date | null;
    loadInDate: string | Date | null;
  };
  groups: Array<{ name: string; rows: PullRow[] }>;
}

const MAX_UNIT_BOXES = 24;

function countRows(rows: readonly PullRow[]): { lines: number; items: number } {
  return rows.reduce((t, r) => ({ lines: t.lines + 1, items: t.items + r.quantity }), { lines: 0, items: 0 });
}

/** One tick box per unit (capped), so a packer ticks each one off. */
function UnitBoxes({ n }: { n: number }) {
  if (n <= 1) return null;
  const shown = Math.min(n, MAX_UNIT_BOXES);
  return (
    <span className="mt-0.5 flex flex-wrap gap-0.5" aria-hidden="true">
      {Array.from({ length: shown }).map((_, i) => <Square key={i} className="size-3 text-muted print:text-black" />)}
      {n > shown ? <span className="text-caption text-muted">+{n - shown}</span> : null}
    </span>
  );
}

function Row({ row, depth }: { row: PullRow; depth: number }) {
  const parent = row.kind === "kit" || row.kind === "group";
  return (
    <>
      <tr className="border-t border-line align-top print:border-black/30">
        <td className="w-8 py-1.5 text-center">
          {parent ? <Container className="mx-auto size-4 text-muted print:text-black" /> : <Square className="mx-auto size-4 text-muted print:text-black" />}
        </td>
        <td className="py-1.5" style={{ paddingLeft: depth * 20 }}>
          <span className={cn(parent ? "font-bold" : depth ? "text-muted" : "font-medium", "text-ink print:text-black")}>
            {row.kind === "kit" ? `[Kit] ${row.name}` : row.name}
          </span>
          {row.kind === "accessory" ? <span className="ml-1.5 text-caption text-muted">accessory</span> : null}
          {row.supplier ? <span className="ml-1.5 text-caption text-info print:text-black">hired in · {row.supplier}</span> : null}
          {row.short ? <span className="ml-1.5 text-caption font-medium text-t-out print:text-black">{row.short === "inside" ? "short inside" : "short"}</span> : null}
          {parent ? null : <UnitBoxes n={row.quantity} />}
        </td>
        <td className="py-1.5 text-center tabular-nums">{parent ? row.children.length : row.quantity}</td>
        <td className="whitespace-nowrap py-1.5 font-mono text-caption text-muted print:text-black">{row.tag === "-" ? "" : row.tag}</td>
        <td className="py-1.5 text-caption text-muted print:text-black">{row.location}</td>
      </tr>
      {row.children.map((c) => <Row key={c.id} row={c} depth={depth + 1} />)}
    </>
  );
}

/**
 * The pull sheet as paper (spec §9c.5): the old pull-sheet page's body, now
 * fed by the ONE pull list the pull-slip PDF reads (`src/lib/pdfme/pull-list.ts`),
 * so screen, print and PDF agree. Rows are in packer-walk (shelf) order inside
 * each category; a sign-off line closes the sheet.
 */
export function PullSheetDocument({ data, printedAt }: { data: PullSheetData; printedAt: string }) {
  const p = data.project;
  const all = data.groups.flatMap((g) => g.rows);
  const totals = countRows(all);
  return (
    <article className="flex flex-col gap-5 text-ui-text print:break-after-page" aria-label={`Pull sheet #${p.projectNumber}`}>
      <header>
        <p className="font-mono text-caption text-muted">#{p.projectNumber}</p>
        <h2 className="font-display text-section-header font-bold text-ink print:text-black">{p.name}</h2>
        {p.clientName ? <p className="text-muted">{p.clientName}</p> : null}
        <p className="mt-1 text-caption text-muted">
          {[
            `Rental ${formatDate(p.rentalStartDate as string | null)} – ${formatDate(p.rentalEndDate as string | null)}`,
            p.loadInDate ? `Load in ${formatDate(p.loadInDate as string | null)}` : null,
            `${totals.lines} lines · ${totals.items} items`,
          ].filter(Boolean).join(" · ")}
        </p>
      </header>
      {data.groups.length === 0 ? <p className="py-6 text-center text-muted">No equipment on this job.</p> : null}
      {data.groups.map((g) => (
        <section key={g.name} className="break-inside-avoid-page">
          <h3 className="mb-1 text-caption font-semibold uppercase tracking-wide text-ink-2 print:text-black">{g.name}</h3>
          <table className="w-full text-[13.5px]">
            <thead className="text-left text-caption text-muted">
              <tr>
                <th className="w-8" aria-label="Picked" />
                <th className="font-medium">Item</th>
                <th className="w-14 text-center font-medium">Qty</th>
                <th className="w-28 font-medium">Tag</th>
                <th className="w-32 font-medium">Shelf</th>
              </tr>
            </thead>
            <tbody>{g.rows.map((r) => <Row key={r.id} row={r} depth={0} />)}</tbody>
          </table>
        </section>
      ))}
      <footer className="mt-4 flex flex-wrap items-end gap-8 border-t border-line pt-3 text-caption text-muted print:border-black/40">
        <span className="min-w-48 flex-1 border-b border-line pb-6 print:border-black/60">Picked by</span>
        <span className="min-w-48 flex-1 border-b border-line pb-6 print:border-black/60">Checked by</span>
        <span>Printed {printedAt}</span>
      </footer>
    </article>
  );
}
