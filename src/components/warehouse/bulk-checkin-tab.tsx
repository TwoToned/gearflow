"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Boxes, Cable, Layers } from "lucide-react";
import { toast } from "sonner";

import { showError } from "@/lib/show-error";
import { useActiveOrganization } from "@/lib/auth-client";
import { useCanDo } from "@/lib/use-permissions";
import {
  getBulkCheckInTotals,
  checkInBulkAccessoryTotals,
} from "@/server/bulk-checkin";
import type { BulkCheckInTotal } from "@/lib/bulk-checkin";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
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

/**
 * Bulk Check-In Totals tab. Aggregates every deployed accessory across the whole
 * project into per-identity totals ("100 clamps due back") and returns a counted
 * quantity in one action — no per-parent drill-down. Roadmap Phase 1.3.
 */
export function BulkCheckInTab({ projectId }: { projectId: string }) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const queryClient = useQueryClient();
  const canCheckIn = useCanDo("warehouse", "check_in");

  const [counts, setCounts] = useState<Record<string, string>>({});
  const [condition, setCondition] = useState<Condition>("GOOD");

  const { data: totals, isLoading } = useQuery({
    queryKey: ["bulk-checkin-totals", orgId, projectId],
    queryFn: () => getBulkCheckInTotals(projectId),
  });

  const rows = (totals ?? []) as BulkCheckInTotal[];

  const mutation = useMutation({
    mutationFn: (returns: Array<{ key: string; quantity: number; condition: Condition }>) =>
      checkInBulkAccessoryTotals(projectId, returns),
    onSuccess: (res) => {
      const total = (res as { returned: Array<{ quantity: number }> }).returned.reduce(
        (s, r) => s + r.quantity,
        0,
      );
      toast.success(total > 0 ? `Checked in ${total} accessor${total === 1 ? "y" : "ies"}` : "Nothing to check in");
      setCounts({});
      queryClient.invalidateQueries({ queryKey: ["bulk-checkin-totals", orgId, projectId] });
      queryClient.invalidateQueries({ queryKey: ["warehouse-project", orgId, projectId] });
    },
    onError: (e) => showError(e, { fallbackTitle: "Bulk check-in failed" }),
  });

  // The quantity the operator intends to return for a row: their typed count,
  // or the full outstanding total when they haven't touched it.
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
      <div className="flex items-center justify-center py-12 text-fg-3">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading...
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="pt-4">
        <EmptyState
          icon={Boxes}
          heading="No accessories to check in"
          description="When gear with permanent accessories is deployed, their clamps, cables and adaptors show here as project-wide totals you can check in all at once."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-start gap-3 rounded-lg bg-bg-surface surface-ring p-4">
        <Layers className="h-5 w-5 text-fg-3 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-fg">Bulk accessory check-in</p>
          <p className="text-xs text-fg-3 mt-0.5">
            Counts are aggregated across every deployed parent. Enter how many you have
            in front of you and check the whole pile in at once.
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

      <div className="rounded-lg bg-bg-surface surface-ring overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Accessory</TableHead>
              <TableHead className="text-center">Due Back</TableHead>
              <TableHead className="w-40 text-right">Check In Qty</TableHead>
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
                        <Boxes className="h-4 w-4 text-fg-3" />
                      ) : (
                        <Cable className="h-4 w-4 text-fg-3" />
                      )}
                      <span className="font-medium text-sm">{row.label}</span>
                      {row.modelNumber && (
                        <span className="font-mono text-xs text-fg-4">{row.modelNumber}</span>
                      )}
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-fg-3">
                        {row.kind === "BULK" ? "Bulk" : "Serialised"}
                      </Badge>
                      {row.childCount > 1 && (
                        <span className="text-xs text-fg-4">across {row.childCount} lines</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center tabular-nums text-sm">{row.totalDue}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={row.totalDue}
                      aria-label={`Check-in quantity for ${row.label}`}
                      aria-invalid={over}
                      className={`h-9 w-24 ml-auto text-right tabular-nums ${over ? "border-destructive" : ""}`}
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

      <div className="flex items-center justify-between">
        <p className="text-sm text-fg-3">
          {hasOverCount ? (
            <span className="text-destructive">A quantity exceeds what's deployed.</span>
          ) : (
            <>
              <span className="font-medium text-fg tabular-nums">{totalSelected}</span> to check in
            </>
          )}
        </p>
        <Button
          onClick={submit}
          disabled={!canCheckIn || mutation.isPending || hasOverCount || totalSelected === 0}
        >
          {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Check In Totals
        </Button>
      </div>
    </div>
  );
}
