"use client";

import { useMemo, useState } from "react";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { Boxes, Cable, Layers } from "lucide-react";
import { toast } from "sonner";

import { showError } from "@/lib/show-error";
import { useActiveOrganization } from "@/lib/auth-client";
import { useCanDo } from "@/lib/use-permissions";
import {
  getBulkCheckInTotals,
  checkInBulkTotals,
} from "@/server/bulk-checkin";
import type { BulkCheckInTotal, CheckInItemType } from "@/lib/bulk-checkin";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Condition = "GOOD" | "DAMAGED" | "MISSING";

const CONDITION_LABELS: Record<Condition, string> = {
  GOOD: "Good",
  DAMAGED: "Damaged",
  MISSING: "Missing",
};

const ITEM_TYPE_LABELS: Record<CheckInItemType, string> = {
  OWNED_SERIALISED: "Asset",
  OWNED_BULK: "Bulk",
  SUBHIRE: "Sub-hire",
  CUSTOM: "Custom",
  ACCESSORY: "Accessory",
};

// Categorical type pills are neutral (§3 — type, not status). Sub-hire reads as
// info (blue) via a status-colors token override on the neutral pill.
const ITEM_TYPE_CLASS: Record<CheckInItemType, string> = {
  OWNED_SERIALISED: "",
  OWNED_BULK: "",
  SUBHIRE: "bg-blue-soft text-blue",
  CUSTOM: "",
  ACCESSORY: "",
};

export function BulkCheckInTab({
  projectId,
  onChanged,
}: {
  projectId: string;
  /** Notify the parent warehouse page to refresh its project composite after a
   *  bulk check-in (replaces the old cross-key ["warehouse-project"] invalidation). */
  onChanged?: () => void;
}) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const canCheckIn = useCanDo("warehouse", "check_in");

  const [counts, setCounts] = useState<Record<string, string>>({});
  const [condition, setCondition] = useState<Condition>("GOOD");

  const { data: totals, isLoading, refetch } = useServerQuery({
    queryKey: ["bulk-checkin-totals", orgId, projectId],
    queryFn: () => getBulkCheckInTotals(projectId),
  });

  const rows = totals ?? [];

  const mutation = useServerMutation({
    mutationFn: (returns: Array<{ key: string; quantity: number; condition: Condition }>) =>
      checkInBulkTotals(projectId, returns),
    onSuccess: (res) => {
      const total = (res as { returned: Array<{ quantity: number }> }).returned.reduce(
        (s, r) => s + r.quantity,
        0,
      );
      toast.success(total > 0 ? `Checked in ${total} item${total === 1 ? "" : "s"}` : "Nothing to check in");
      setCounts({});
      refetch();
      onChanged?.();
    },
    onError: (e) => showError(e, { fallbackTitle: "Bulk check-in failed" }),
  });

  const intendedQty = (row: BulkCheckInTotal): number => {
    const raw = counts[row.key];
    if (raw === undefined || raw === "") return row.totalDue;
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  const totalSelected = useMemo(
    () => rows.reduce((s, row) => s + Math.min(intendedQty(row), row.totalDue), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, counts],
  );

  const hasOverCount = rows.some((row) => intendedQty(row) > row.totalDue);

  const submit = () => {
    const returns = rows
      .map((row) => ({ key: row.key, quantity: intendedQty(row), condition }))
      .filter((r) => r.quantity > 0);
    if (returns.length === 0) {
      toast.info("Enter a quantity to check in");
      return;
    }
    mutation.mutate(returns);
  };

  if (isLoading) {
    return (
      <div className="space-y-4 pt-4" aria-busy="true">
        <Skeleton className="h-20 rounded-[var(--r)]" />
        <Skeleton className="h-40 rounded-[var(--r-lg)]" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="pt-4">
        <EmptyState
          title="No deployed items to check in"
          description="When gear is deployed, it shows here as project-wide totals you can check in all at once."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-start gap-3 rounded-[var(--r)] bg-card ring-1 ring-line shadow-[var(--sh-card)] p-4">
        <Layers className="h-5 w-5 text-muted shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-ui-text font-medium text-ink">Bulk check-in</p>
          <p className="text-caption text-muted mt-0.5">
            Counts are aggregated across the whole project. Enter how many you have
            in front of you and check them all in at once.
          </p>
        </div>
        <div className="w-40">
          <Label htmlFor="bulk-condition" className="sr-only">Condition</Label>
          <Select value={condition} onValueChange={(v) => setCondition(v as Condition)}>
            <SelectTrigger id="bulk-condition">
              <SelectValue>{CONDITION_LABELS[condition]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GOOD">Good</SelectItem>
              <SelectItem value="DAMAGED">Damaged</SelectItem>
              <SelectItem value="MISSING">Missing</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Desktop: data table */}
      <div className="hidden md:block rounded-[var(--r-lg)] bg-card ring-1 ring-line shadow-[var(--sh-card)] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-center">Due back</TableHead>
              <TableHead className="w-40 text-right">Check-in qty</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const over = intendedQty(row) > row.totalDue;
              return (
                <TableRow key={row.key}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {row.kind === "BULK" ? (
                        <Boxes className="h-4 w-4 text-muted" />
                      ) : (
                        <Cable className="h-4 w-4 text-muted" />
                      )}
                      <span className="font-medium text-table-cell text-ink">{row.label}</span>
                      {row.modelNumber && (
                        <span className="t-mono text-faint">{row.modelNumber}</span>
                      )}
                      <Badge status="neutral" className={ITEM_TYPE_CLASS[row.itemType]}>
                        {ITEM_TYPE_LABELS[row.itemType]}
                      </Badge>
                      {row.childCount > 1 && (
                        <span className="text-caption text-faint">across {row.childCount} lines</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center tabular-nums text-table-cell">{row.totalDue}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={row.totalDue}
                      aria-label={`Check-in quantity for ${row.label}`}
                      aria-invalid={over ? "true" : "false"}
                      className="h-11 w-24 ml-auto text-right tabular-nums"
                      value={counts[row.key] ?? String(row.totalDue)}
                      onChange={(e) =>
                        setCounts((c) => ({ ...c, [row.key]: e.target.value }))
                      }
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: card list (§15) — same rows + counts handler */}
      <div className="md:hidden space-y-2">
        {rows.map((row) => {
          const over = intendedQty(row) > row.totalDue;
          return (
            <div key={row.key} className="rounded-[var(--r)] bg-card ring-1 ring-line shadow-[var(--sh-card)] p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {row.kind === "BULK" ? (
                  <Boxes className="h-4 w-4 shrink-0 text-muted" />
                ) : (
                  <Cable className="h-4 w-4 shrink-0 text-muted" />
                )}
                <span className="font-medium text-ui-text text-ink">{row.label}</span>
                {row.modelNumber && (
                  <span className="t-mono text-caption text-faint">{row.modelNumber}</span>
                )}
                <Badge status="neutral" className={ITEM_TYPE_CLASS[row.itemType]}>
                  {ITEM_TYPE_LABELS[row.itemType]}
                </Badge>
              </div>
              {row.childCount > 1 && (
                <p className="mt-0.5 text-caption text-faint">across {row.childCount} lines</p>
              )}
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-caption text-muted tabular-nums">
                  Due back <span className="font-medium text-ink">{row.totalDue}</span>
                </span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={row.totalDue}
                  aria-label={`Check-in quantity for ${row.label}`}
                  aria-invalid={over ? "true" : "false"}
                  className="h-11 w-24 text-right tabular-nums"
                  value={counts[row.key] ?? String(row.totalDue)}
                  onChange={(e) =>
                    setCounts((c) => ({ ...c, [row.key]: e.target.value }))
                  }
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-ui-text text-muted">
          {hasOverCount ? (
            <span className="text-t-out">A quantity exceeds what&apos;s deployed.</span>
          ) : (
            <>
              <span className="font-medium text-ink tabular-nums">{totalSelected}</span> to check in
            </>
          )}
        </p>
        <Button
          onClick={submit}
          disabled={!canCheckIn || mutation.isPending || hasOverCount || totalSelected === 0}
          loading={mutation.isPending}
        >
          Check in totals
        </Button>
      </div>
    </div>
  );
}
