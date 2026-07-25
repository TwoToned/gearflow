"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpDown } from "lucide-react";

import { Stat } from "@/components/ui/stat";
import { Panel } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFleetRoi, useZeroPricedGroups, type FleetRoiData } from "@/hooks/use-roi";
import { formatCurrency } from "@/lib/formatters";
import { defaultRoiWindow, ROI_SCOPE_LABELS, type RoiScope } from "@/lib/roi";
import { PaybackBar } from "@/components/roi/payback-bar";
import { cn } from "@/lib/utils";

/**
 * Fleet ROI — every model ranked by what it earned against what it cost to own.
 *
 * The rows that matter most are the ones with revenue $0 and a real fleet cost.
 * They're why this reads off `fleetInventory` rather than off revenue alone: dead
 * capital never shows up in a revenue-driven query, because it produced no rows.
 */

type FleetRoi = FleetRoiData;
type Row = FleetRoi["rows"][number];
type SortKey = "revenue" | "payback" | "revenuePerUnit" | "fleetCost";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "payback", label: "Payback" },
  { key: "revenuePerUnit", label: "Revenue per unit" },
  { key: "fleetCost", label: "Fleet cost" },
];

/** Nulls last regardless of direction — "unknown" is never the best or worst row. */
const compare = (a: Row, b: Row, key: SortKey, asc: boolean): number => {
  const x = a[key];
  const y = b[key];
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return asc ? x - y : y - x;
};

export function FleetRoi() {
  const [scope, setScope] = useState<RoiScope>("earned");
  const [allTime, setAllTime] = useState(false);
  const [sort, setSort] = useState<SortKey>("revenue");
  const [asc, setAsc] = useState(false);
  const [q, setQ] = useState("");

  const window = useMemo(() => (allTime ? undefined : defaultRoiWindow(scope)), [allTime, scope]);

  const { data, isLoading } = useFleetRoi({ scope, from: window?.from, to: window?.to });
  const { data: zeroPriced } = useZeroPricedGroups(scope);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? data.rows.filter(
          (r) =>
            r.modelName.toLowerCase().includes(needle) ||
            (r.manufacturer ?? "").toLowerCase().includes(needle),
        )
      : data.rows;
    return [...filtered].sort((a, b) => compare(a, b, sort, asc));
  }, [data, q, sort, asc]);

  if (isLoading || !data) return <Skeleton className="h-96 w-full" />;

  const earning = data.rows.filter((r) => r.revenue > 0).length;
  const idle = data.rows.filter((r) => r.revenue === 0 && (r.fleetCost ?? 0) > 0);
  const idleCapital = idle.reduce((s, r) => s + (r.fleetCost ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Panel>
          <Stat bright figure={formatCurrency(data.totalRevenue)} label="Revenue attributed" />
        </Panel>
        <Panel>
          <Stat figure={formatCurrency(data.totalFleetCost)} label="Fleet cost" />
        </Panel>
        <Panel>
          <Stat figure={`${earning}`} label={`Models earning (of ${data.rows.length})`} />
        </Panel>
        <Panel>
          <Stat
            figure={formatCurrency(idleCapital)}
            label={`Idle capital (${idle.length} model${idle.length === 1 ? "" : "s"})`}
          />
        </Panel>
      </div>

      {data.truncated && (
        <div className="flex gap-3 rounded-md border border-warn/40 bg-warn-soft p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          <p className="text-caption text-ink-2">
            Showing a partial picture — this report hit its scan limit at{" "}
            {data.projectsCounted} projects. Narrow the window for exact figures.
          </p>
        </div>
      )}

      {zeroPriced && zeroPriced.rows.length > 0 && (
        <details className="rounded-md border border-warn/40 bg-warn-soft">
          <summary className="flex cursor-pointer list-none items-start gap-3 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
            <span className="text-caption text-ink-2">
              {zeroPriced.rows.length} group{zeroPriced.rows.length === 1 ? "" : "s"} with real
              gear but no price set — that gear is reporting $0 revenue here (and on the
              project itself).{" "}
              <span className="text-link">Show groups</span>
              {zeroPriced.truncated && " (partial — hit the scan limit)"}
            </span>
          </summary>
          <ul className="space-y-1 border-t border-warn/40 px-3 py-2">
            {zeroPriced.rows.map((r) => (
              <li
                key={`${r.projectId}:${r.groupId}`}
                className="flex flex-wrap items-baseline justify-between gap-x-3 text-caption text-ink-2"
              >
                <span>
                  <Link href={`/projects/${r.projectId}`} className="text-link hover:underline">
                    {r.projectNumber} — {r.projectName}
                  </Link>{" "}
                  · &ldquo;{r.groupTitle}&rdquo; ({r.gearLineCount} gear line
                  {r.gearLineCount === 1 ? "" : "s"})
                </span>
                <span className="text-faint">
                  {r.suggestedPrice != null
                    ? `suggested ${formatCurrency(r.suggestedPrice)}`
                    : "no suggested price"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Filter models…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-8 w-56"
          aria-label="Filter models"
        />
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
        <span className="ml-auto text-caption text-faint">
          {data.projectsCounted} project{data.projectsCounted === 1 ? "" : "s"} counted
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing to report yet"
          description="Once projects are completed or invoiced, the gear that went out on them will show up here."
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full min-w-[860px]">
            <thead>
              <tr className="border-b border-line bg-paper-2">
                <th className="px-3 py-2 text-left text-caption text-muted">Model</th>
                <th className="px-3 py-2 text-right text-caption text-muted">Units</th>
                {SORTS.map((s) => (
                  <th key={s.key} className="px-3 py-2 text-right text-caption">
                    <button
                      type="button"
                      onClick={() => {
                        if (sort === s.key) setAsc((v) => !v);
                        else {
                          setSort(s.key);
                          setAsc(false);
                        }
                      }}
                      className={cn(
                        "inline-flex items-center gap-1 hover:text-ink",
                        sort === s.key ? "text-ink" : "text-muted",
                      )}
                      aria-label={`Sort by ${s.label}`}
                    >
                      {s.label}
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                ))}
                <th className="w-48 px-3 py-2 text-left text-caption text-muted">
                  Cost recovered
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.modelId} className="border-b border-line last:border-0 hover:bg-paper-2">
                  <td className="px-3 py-2 text-table-cell">
                    <Link
                      href={`/assets/models/${r.modelId}?tab=roi`}
                      className="text-link hover:underline"
                    >
                      {r.modelName}
                    </Link>
                    {r.manufacturer && (
                      <span className="ml-2 text-caption text-faint">{r.manufacturer}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-table-cell tabular-nums text-muted">
                    {r.unitsOwned}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right text-table-cell tabular-nums",
                      r.revenue > 0 ? "text-ink" : "text-faint",
                    )}
                  >
                    {formatCurrency(r.revenue)}
                  </td>
                  <td className="px-3 py-2 text-right text-table-cell tabular-nums text-ink-2">
                    {r.payback != null ? `${r.payback.toFixed(2)}×` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-table-cell tabular-nums text-ink-2">
                    {r.revenuePerUnit != null ? formatCurrency(r.revenuePerUnit) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-table-cell tabular-nums text-muted">
                    {r.fleetCost != null ? formatCurrency(r.fleetCost) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <PaybackBar payback={r.payback} showLabel={false} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
