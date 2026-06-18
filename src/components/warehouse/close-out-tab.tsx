"use client";

import { useEffect, useRef, useState } from "react";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useWarehouseCloses, fingerprintWarehouseCloses } from "@/hooks/use-back-office";
import {
  PackageCheck,
  AlertTriangle,
  CheckCircle2,
  Lock,
} from "lucide-react";
import { toast } from "sonner";

import { getCloseOutSummary, closeOutProject } from "@/server/warehouse-close";
import { useActiveOrganization } from "@/lib/auth-client";
import { useCanDo } from "@/lib/use-permissions";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Sentence-case labels (§5.2) for the exceptions table — the raw enum values
// (CHECKED_OUT, DAMAGED) must never render directly.
const STATUS_LABELS: Record<string, string> = {
  QUOTED: "Quoted",
  CONFIRMED: "Confirmed",
  PREPPED: "Prepped",
  CHECKED_OUT: "Deployed",
  RETURNED: "Returned",
  CANCELLED: "Cancelled",
};

const CONDITION_LABELS: Record<string, string> = {
  GOOD: "Good",
  DAMAGED: "Damaged",
  MISSING: "Missing",
};

export function CloseOutTab({
  projectId,
  onChanged,
}: {
  projectId: string;
  /** Notify the parent warehouse page to refresh its project composite after a
   *  close-out (replaces the old cross-key ["warehouse-project"] invalidation). */
  onChanged?: () => void;
}) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const canClose = useCanDo("warehouse", "close");

  const [confirmStep, setConfirmStep] = useState(0); // 0 = none, 1 = first click, 2 = confirmed

  const { data: summary, isLoading, refetch } = useServerQuery({
    queryKey: ["close-out-summary", orgId, projectId],
    queryFn: () => getCloseOutSummary(projectId),
  });

  // Cross-tab live sync: subscribe to the dual-written Convex warehouseCloses
  // table; if another staffer closes this project, the fingerprint changes and
  // we re-fetch (so the "already closed" banner appears live).
  const closeDocs = useWarehouseCloses(orgId);
  const closeFp = fingerprintWarehouseCloses(closeDocs);
  const prevCloseFp = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (closeFp !== undefined && prevCloseFp.current !== undefined && closeFp !== prevCloseFp.current) {
      refetch();
    }
    if (closeFp !== undefined) prevCloseFp.current = closeFp;
  }, [closeFp, refetch]);

  const closeMutation = useServerMutation({
    mutationFn: () => closeOutProject({ projectId }),
    onSuccess: () => {
      toast.success("Project closed out successfully");
      refetch();
      onChanged?.();
      setConfirmStep(0);
    },
    onError: (e) => {
      toast.error(e.message);
      setConfirmStep(0);
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6 pt-4" aria-busy="true">
        <Skeleton className="h-20 rounded-[var(--r)]" />
        <Skeleton className="h-40 rounded-[var(--r-lg)]" />
      </div>
    );
  }

  if (!summary) return null;

  const s = summary as Record<string, unknown>;
  const totalItems = s.totalItems as number;
  const storedCount = s.storedCount as number;
  const damagedCount = s.damagedCount as number;
  const lostCount = s.lostCount as number;
  const pendingCount = s.pendingCount as number;
  const canCloseOut = s.canClose as boolean;
  const alreadyClosed = s.alreadyClosed as boolean;
  const closedAt = s.closedAt as string | null;
  const closedBy = s.closedBy as string | null;
  const exceptions = s.exceptions as Array<{
    lineItemId: string;
    modelName: string;
    assetTag: string | null;
    status: string;
    returnCondition: string | null;
    returnStatus: string | null;
  }>;

  return (
    <div className="space-y-6">
      {/* Already closed banner */}
      {alreadyClosed && (
        <div className="flex items-center gap-3 rounded-[var(--r)] border-l-[3px] border-l-ok bg-card p-4 ring-1 ring-line">
          <CheckCircle2 className="h-5 w-5 text-ok shrink-0" />
          <div>
            <p className="text-ui-text font-medium text-ok">Project closed out</p>
            <p className="text-caption text-muted">
              Closed{closedBy ? ` by ${closedBy}` : ""}{closedAt ? ` on ${new Date(closedAt).toLocaleDateString()}` : ""}
            </p>
          </div>
        </div>
      )}

      {/* Summary metrics strip */}
      <div className="flex items-center rounded-[var(--r)] bg-card ring-1 ring-line shadow-[var(--sh-card)] divide-x divide-line">
        <div className="flex-1 px-4 py-3">
          <p className="t-title t-data text-ink">{totalItems}</p>
          <p className="t-micro text-muted mt-0.5">Total items</p>
        </div>
        <div className="flex-1 px-4 py-3">
          <p className="t-title t-data text-ok">{storedCount}</p>
          <p className="t-micro text-muted mt-0.5">Stored</p>
        </div>
        <div className="flex-1 px-4 py-3">
          <p className={`t-title t-data ${damagedCount > 0 ? "text-warn" : "text-muted"}`}>
            {damagedCount}
          </p>
          <p className="t-micro text-muted mt-0.5">Damaged</p>
        </div>
        <div className="flex-1 px-4 py-3">
          <p className={`t-title t-data ${lostCount > 0 ? "text-t-out" : "text-muted"}`}>
            {lostCount}
          </p>
          <p className="t-micro text-muted mt-0.5">Lost</p>
        </div>
      </div>

      {/* Pending items warning */}
      {pendingCount > 0 && (
        <div className="flex items-center gap-3 rounded-[var(--r)] border-l-[3px] border-l-warn bg-card p-4 ring-1 ring-line">
          <AlertTriangle className="h-5 w-5 text-warn shrink-0" />
          <div>
            <p className="text-ui-text font-medium text-warn">
              {pendingCount} item{pendingCount !== 1 ? "s" : ""} still pending
            </p>
            <p className="text-caption text-muted">
              All items must be returned before closing out.
            </p>
          </div>
        </div>
      )}

      {/* Exceptions table */}
      {exceptions.length > 0 && (
        <div>
          <h3 className="text-heading font-bold text-ink mb-2">Exceptions</h3>
          <div className="rounded-[var(--r-lg)] bg-card ring-1 ring-line shadow-[var(--sh-card)] overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Asset tag</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Condition</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exceptions.map((exc) => (
                  <TableRow key={exc.lineItemId}>
                    <TableCell className="font-medium text-table-cell text-ink">{exc.modelName}</TableCell>
                    <TableCell className="t-mono text-muted">
                      {exc.assetTag || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge status="neutral">
                        {STATUS_LABELS[exc.status] || exc.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {exc.returnCondition ? (
                        <Badge
                          status={
                            exc.returnCondition === "DAMAGED"
                              ? "warn"
                              : exc.returnCondition === "MISSING"
                                ? "overbooked"
                                : "neutral"
                          }
                        >
                          {CONDITION_LABELS[exc.returnCondition] || exc.returnCondition}
                        </Badge>
                      ) : (
                        <span className="text-muted text-table-cell">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Close button */}
      {!alreadyClosed && canClose && (
        <div className="border-t border-line pt-4">
          {!canCloseOut ? (
            <div className="flex items-center gap-2 text-ui-text text-muted">
              <Lock className="h-4 w-4" />
              Close-out blocked until all items are returned.
            </div>
          ) : confirmStep === 0 ? (
            <Button
              variant="line"
              className="text-t-out hover:bg-red hover:text-white hover:border-red"
              onClick={() => setConfirmStep(1)}
              disabled={closeMutation.isPending}
            >
              <PackageCheck className="mr-2 h-4 w-4" />
              Close out project
            </Button>
          ) : (
            <div className="flex items-center gap-3">
              <p className="text-ui-text text-muted">
                Are you sure? This action cannot be undone.
              </p>
              <Button
                variant="line"
                size="sm"
                onClick={() => setConfirmStep(0)}
              >
                Cancel
              </Button>
              <Button
                variant="line"
                size="sm"
                className="text-t-out hover:bg-red hover:text-white hover:border-red"
                onClick={() => closeMutation.mutate()}
                disabled={closeMutation.isPending}
                loading={closeMutation.isPending}
              >
                Confirm close
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
