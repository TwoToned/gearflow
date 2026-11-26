"use client";

import * as React from "react";
import Link from "next/link";

import { SubHireShortfallDialog } from "@/components/overbookings/sub-hire-shortfall-dialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { displayDate, keyOfMs } from "@/lib/crew-planner";
import { formatWeekdayDayMonth } from "@/lib/formatters";
import { claimsOnDay, type GearCell, type GearClaim, type GearRow } from "@/lib/schedule-gear";
import { intentStyles } from "@/lib/status-colors";
import { cn } from "@/lib/utils";

/**
 * The model-day sheet (spec §9o.4): what a Gear cell opens. Serviceable, Held and
 * Free for that model on that day; `Held by` (each opens the job sheet),
 * `Pencilled, holds nothing`, and for a pencilled risk the line `would be short 2
 * if #2350 confirms`. Then `Sub-hire n…` (a hard shortfall, `subHire:create`),
 * `Overbookings ›` and `Open model ›` (`model:read`): a verb the caller cannot
 * use is absent, never disabled. Driven by the URL (`?cell=model:day`) and read
 * from the LIVE grid every render.
 */
export interface OpenedCell {
  row: GearRow;
  cell: GearCell;
  dayStart: number;
}

interface Props {
  opened: OpenedCell | null;
  onOpenJob: (id: string) => void;
  onClose: () => void;
  canSubHire: boolean;
  canModel: boolean;
}

function Claims({ title, claims, onOpenJob }: { title: string; claims: GearClaim[]; onOpenJob: (id: string) => void }) {
  if (claims.length === 0) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <h3 className="text-caption font-medium uppercase tracking-wide text-muted">{title}</h3>
      <ul className="flex flex-col divide-y divide-line">
        {claims.map((c) => (
          <li key={c.projectId}>
            <button type="button" onClick={() => onOpenJob(c.projectId)} className="flex min-h-11 w-full items-center gap-2 text-left text-ui-text text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red">
              <span className="font-mono font-medium">{c.projectNumber}</span>
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="font-mono text-muted">× {c.qty}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Numbers({ row, cell }: { row: GearRow; cell: GearCell }) {
  if (cell.unknown) {
    return <p className="text-ui-text text-muted">Not checked. This model&apos;s bookings, or its stock, are more than the Schedule reads at once, so no number is shown.</p>;
  }
  return (
    <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-ui-text">
      <dt className="text-muted">Serviceable</dt>
      <dd className="font-mono text-ink">{row.owned - row.inService}</dd>
      <dt className="text-muted">Held</dt>
      <dd className="font-mono text-ink">{cell.held}</dd>
      <dt className="text-muted">Free</dt>
      <dd className={cn("font-mono", cell.short > 0 ? intentStyles.error.text : "text-ink")}>{cell.free}</dd>
    </dl>
  );
}

export function ModelDaySheet({ opened, onOpenJob, onClose, canSubHire, canModel }: Props) {
  const side = useIsMobile() ? "bottom" : "right";
  const [subHire, setSubHire] = React.useState(false);
  const on = opened ? claimsOnDay(opened.row, opened.dayStart) : null;
  const risk = opened && !opened.cell.unknown && opened.cell.atRisk > 0 && on ? on.pencilled.map((c) => c.projectNumber).join(", ") : "";
  return (
    <Sheet open={!!opened} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={side} className="overflow-y-auto sm:max-w-md">
        {opened && on && (
          <div className="flex flex-col gap-5 p-1">
            <SheetHeader>
              <SheetTitle>{opened.row.name}</SheetTitle>
              <SheetDescription>{formatWeekdayDayMonth(displayDate(keyOfMs(opened.dayStart)))}</SheetDescription>
            </SheetHeader>
            <Numbers row={opened.row} cell={opened.cell} />
            {risk && <p className={cn("text-ui-text", intentStyles.warning.text)}>would be short {opened.cell.atRisk} if {risk} confirm{on.pencilled.length === 1 ? "s" : ""}</p>}
            <Claims title="Held by" claims={on.held} onOpenJob={onOpenJob} />
            <Claims title="Pencilled, holds nothing" claims={on.pencilled} onOpenJob={onOpenJob} />
            <SheetFooter className="flex-col gap-2 sm:flex-col">
              {canSubHire && !opened.cell.unknown && opened.cell.short > 0 && (
                <Button type="button" variant="line" onClick={() => setSubHire(true)}>
                  Sub-hire {opened.cell.short}…
                </Button>
              )}
              <Button asChild variant="line">
                <Link href="/overbookings">Overbookings ›</Link>
              </Button>
              {canModel && (
                <Button asChild variant="line">
                  <Link href={`/assets/models/${opened.row.modelId}`}>Open model ›</Link>
                </Button>
              )}
            </SheetFooter>
            <SubHireShortfallDialog
              open={subHire}
              onOpenChange={setSubHire}
              modelName={opened.row.name}
              shortfallQty={opened.cell.short}
              projects={on.held.map((c) => ({ id: c.projectId, name: c.name, projectNumber: c.projectNumber }))}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
