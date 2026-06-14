"use client";

import { useEffect, useRef, useState } from "react";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useWarehouseCloses, fingerprintWarehouseCloses } from "@/hooks/use-back-office";
import {
  Loader2,
  PackageCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Lock,
} from "lucide-react";
import { toast } from "sonner";

import { getCloseOutSummary, closeOutProject } from "@/server/warehouse-close";
import { useActiveOrganization } from "@/lib/auth-client";
import { useCanDo } from "@/lib/use-permissions";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
      <div className="flex items-center justify-center py-12 text-fg-3">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading...
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
        <div className="flex items-center gap-3 rounded-lg border-l-[3px] border-l-green-500 bg-bg-surface p-4">
          <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-green-500">Project Closed Out</p>
            <p className="text-xs text-fg-3">
              Closed{closedBy ? ` by ${closedBy}` : ""}{closedAt ? ` on ${new Date(closedAt).toLocaleDateString()}` : ""}
            </p>
          </div>
        </div>
      )}

      {/* Summary metrics strip */}
      <div className="flex items-center rounded-lg bg-bg-surface surface-ring divide-x divide-border">
        <div className="flex-1 px-4 py-3">
          <p className="t-title t-data">{totalItems}</p>
          <p className="t-micro text-fg-3 mt-0.5">Total Items</p>
        </div>
        <div className="flex-1 px-4 py-3">
          <p className="t-title t-data text-green-500">{storedCount}</p>
          <p className="t-micro text-fg-3 mt-0.5">Stored</p>
        </div>
        <div className="flex-1 px-4 py-3">
          <p className={`t-title t-data ${damagedCount > 0 ? "text-amber-500" : "text-fg-3"}`}>
            {damagedCount}
          </p>
          <p className="t-micro text-fg-3 mt-0.5">Damaged</p>
        </div>
        <div className="flex-1 px-4 py-3">
          <p className={`t-title t-data ${lostCount > 0 ? "text-destructive" : "text-fg-3"}`}>
            {lostCount}
          </p>
          <p className="t-micro text-fg-3 mt-0.5">Lost</p>
        </div>
      </div>

      {/* Pending items warning */}
      {pendingCount > 0 && (
        <div className="flex items-center gap-3 rounded-lg border-l-[3px] border-l-amber-500 bg-bg-surface p-4">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-500">
              {pendingCount} item{pendingCount !== 1 ? "s" : ""} still pending
            </p>
            <p className="text-xs text-fg-3">
              All items must be returned before closing out.
            </p>
          </div>
        </div>
      )}

      {/* Exceptions table */}
      {exceptions.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Exceptions</h3>
          <div className="rounded-lg bg-bg-surface surface-ring overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Asset Tag</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Condition</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exceptions.map((exc) => (
                  <TableRow key={exc.lineItemId}>
                    <TableCell className="font-medium text-sm">{exc.modelName}</TableCell>
                    <TableCell className="font-mono text-sm text-fg-3">
                      {exc.assetTag || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {exc.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {exc.returnCondition ? (
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            exc.returnCondition === "DAMAGED"
                              ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                              : exc.returnCondition === "MISSING"
                                ? "bg-destructive/10 text-destructive border-destructive/20"
                                : ""
                          }`}
                        >
                          {exc.returnCondition}
                        </Badge>
                      ) : (
                        <span className="text-fg-3 text-sm">—</span>
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
        <div className="border-t border-border pt-4">
          {!canCloseOut ? (
            <div className="flex items-center gap-2 text-sm text-fg-3">
              <Lock className="h-4 w-4" />
              Close-out blocked until all items are returned.
            </div>
          ) : confirmStep === 0 ? (
            <Button
              variant="destructive"
              onClick={() => setConfirmStep(1)}
              disabled={closeMutation.isPending}
            >
              <PackageCheck className="mr-2 h-4 w-4" />
              Close Out Project
            </Button>
          ) : (
            <div className="flex items-center gap-3">
              <p className="text-sm text-fg-3">
                Are you sure? This action cannot be undone.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmStep(0)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => closeMutation.mutate()}
                disabled={closeMutation.isPending}
              >
                {closeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirm Close
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
