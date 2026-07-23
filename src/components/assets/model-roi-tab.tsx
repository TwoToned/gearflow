"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Info } from "lucide-react";

import { Stat } from "@/components/ui/stat";
import { Panel } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { MobileCardList, type ColumnDef } from "@/components/ui/data-table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useModelRoi, type ModelRoiData } from "@/hooks/use-roi";
import { formatCurrency, formatDate } from "@/lib/formatters";
import {
  formatPayback,
  defaultRoiWindow,
  ROI_SCOPE_LABELS,
  type RoiScope,
} from "@/lib/roi";
import { PaybackBar } from "@/components/roi/payback-bar";

/**
 * What this model has earned, against what it cost to own.
 *
 * Revenue comes from the allocation snapshot — every line item's share of the kit
 * or bundle price it was part of — so gear that only ever ships inside a kit still
 * reports earnings. See docs/revenue-allocation-design.md.
 */

type ModelRoi = ModelRoiData;

export function ModelRoiTab({ modelId }: { modelId: string }) {
  const [scope, setScope] = useState<RoiScope>("earned");
  const [allTime, setAllTime] = useState(false);

  const window = useMemo(() => (allTime ? undefined : defaultRoiWindow()), [allTime]);

  const { data, isLoading } = useModelRoi(modelId, { scope, from: window?.from, to: window?.to });

  if (isLoading || !data) return <Skeleton className="h-72 w-full" />;

  // Mobile card layout for the "where it earned" projects table (rendered below `md`).
  const projectColumns: ColumnDef<ModelRoi["projects"][number]>[] = [
    {
      id: "project",
      header: "Project",
      mobile: "title",
      cell: (p) => (
        <Link href={`/projects/${p.projectId}`} className="text-link hover:underline">
          {p.projectNumber} — {p.name}
        </Link>
      ),
    },
    {
      id: "status",
      header: "Status",
      mobile: "badge",
      cell: (p) => <span className="text-muted">{p.status}</span>,
    },
    {
      id: "date",
      header: "Rental start",
      mobile: "meta",
      cell: (p) => (
        <span className="text-muted">{p.date ? formatDate(new Date(p.date)) : "—"}</span>
      ),
    },
    {
      id: "revenue",
      header: "Attributed",
      mobile: "meta",
      cell: (p) => (
        <span className="tabular-nums text-ink">{formatCurrency(p.revenue)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={scope} onValueChange={(v) => setScope(v as RoiScope)}>
          <SelectTrigger className="h-8 w-56">
            <SelectValue>{ROI_SCOPE_LABELS[scope]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ROI_SCOPE_LABELS) as RoiScope[]).map((s) => (
              <SelectItem key={s} value={s}>
                {ROI_SCOPE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={allTime ? "all" : "12m"} onValueChange={(v) => setAllTime(v === "all")}>
          <SelectTrigger className="h-8 w-44">
            <SelectValue>{allTime ? "All time" : "Last 12 months"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="12m">Last 12 months</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>

        {/* Tooltip throws without a Provider ancestor, and there is no global one.
            The Trigger renders its own <button>, so props go directly on it. */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              aria-label="How revenue is attributed"
              className="text-faint hover:text-muted"
            >
              <Info className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              Revenue is this model&rsquo;s share of every job it went out on — including
              its slice of any kit or bundle price. Sub-hired units are excluded: that
              wasn&rsquo;t your capital.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {data.truncated && (
        <div className="flex gap-3 rounded-md border border-warn/40 bg-warn-soft p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          <p className="text-caption text-ink-2">
            Showing a partial picture — this model hit a scan limit. Revenue may be
            understated and payback overstated. Narrow the date range for exact figures.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Panel>
          <Stat bright figure={formatCurrency(data.revenue)} label="Revenue attributed" />
        </Panel>
        <Panel>
          <Stat
            figure={data.fleetCost != null ? formatCurrency(data.fleetCost) : "—"}
            label={`Fleet cost (${data.unitsOwned} unit${data.unitsOwned === 1 ? "" : "s"})`}
          />
        </Panel>
        <Panel>
          <Stat figure={formatPayback(data.payback)} label="Paid for itself" />
        </Panel>
        <Panel>
          <Stat
            figure={data.revenuePerUnit != null ? formatCurrency(data.revenuePerUnit) : "—"}
            label="Revenue per unit"
          />
        </Panel>
      </div>

      {data.fleetCost == null ? (
        <p className="text-caption text-muted">
          {data.unitsOwned === 0
            ? "No units of this model are in the fleet, so there is no capital to measure against."
            : "Set a replacement cost on this model to see how far it is from paying for itself."}
        </p>
      ) : (
        <Panel>
          <div className="mb-3 flex items-baseline justify-between">
            <p className="text-card-title text-ink">Cost recovered</p>
            <p className="text-caption tabular-nums text-muted">
              {data.stillToRecover! > 0
                ? `${formatCurrency(data.stillToRecover!)} to break even`
                : "Fully recovered"}
            </p>
          </div>
          <PaybackBar payback={data.payback} />
        </Panel>
      )}

      <div>
        <h4 className="text-card-title text-ink mb-3">
          Where it earned ({data.projects.length} project
          {data.projects.length === 1 ? "" : "s"})
        </h4>
        {data.projects.length === 0 ? (
          <EmptyState
            title="No revenue in this window"
            description="Widen the date range, or include booked work that hasn't been invoiced yet."
          />
        ) : (
          /* overflow-x-auto, not overflow-hidden: five columns clip rather than scroll on a phone. */
          <div className="hidden overflow-x-auto rounded-md border border-line md:block">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-line bg-paper-2">
                  <th className="px-3 py-2 text-left text-caption text-muted">Project</th>
                  <th className="px-3 py-2 text-left text-caption text-muted">Status</th>
                  <th className="px-3 py-2 text-left text-caption text-muted">Rental start</th>
                  <th className="px-3 py-2 text-right text-caption text-muted">Attributed</th>
                </tr>
              </thead>
              <tbody>
                {data.projects.map((p) => (
                  <tr key={p.projectId} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 text-table-cell">
                      <Link href={`/projects/${p.projectId}`} className="text-link hover:underline">
                        {p.projectNumber} — {p.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-table-cell text-muted">{p.status}</td>
                    <td className="px-3 py-2 text-table-cell text-muted">
                      {p.date ? formatDate(new Date(p.date)) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-table-cell tabular-nums text-ink">
                      {formatCurrency(p.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.projects.length > 0 && (
          <MobileCardList
            className="md:hidden"
            data={data.projects}
            columns={projectColumns}
            getRowId={(p) => p.projectId}
          />
        )}
      </div>
    </div>
  );
}
