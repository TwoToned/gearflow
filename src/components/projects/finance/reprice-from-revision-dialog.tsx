"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { toast } from "sonner";

import { api } from "../../../../convex/_generated/api";
import { useQuoteWrites } from "@/hooks/use-quote-writes";
import { diffSnapshotEntries, type SnapshotEntryLike } from "@/lib/project-snapshot-diff";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface RepriceFromRevisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  orgId: string;
  sourceQuoteId: string;
  sourceSnapshotId: string;
  sourceVersion: number;
  nextVersion: number;
  onDone?: (result: { id: string; version: number }) => void;
}

/**
 * "Use vN's pricing for v(N+1)" confirm dialog (#989 §8.1) — the forward-only
 * equivalent of "Restore" every version-history pattern studied offers and this
 * program deliberately doesn't (rewriting a SENT quote in place would falsify
 * the record of what a client was given).
 *
 * Discloses both surprises BEFORE running: how many items added since the
 * source revision have no price in it (they'll be unpriced — the exact
 * `UnpricedBadge` case), and whether the rental window has moved since (prices
 * from an older window may no longer reflect the actual duration). Silent $0
 * lines on a quote are exactly the failure this program exists to prevent, so
 * this is stated up front rather than discovered afterwards via badges.
 */
export function RepriceFromRevisionDialog({
  open,
  onOpenChange,
  projectId,
  orgId,
  sourceQuoteId,
  sourceSnapshotId,
  sourceVersion,
  nextVersion,
  onDone,
}: RepriceFromRevisionDialogProps) {
  const quoteWrites = useQuoteWrites();
  const [pending, setPending] = useState(false);

  const sourceEntries = useQuery(
    api.projectLocksRead.snapshotEntries,
    open ? { snapshotId: sourceSnapshotId, orgId } : "skip",
  );
  const currentEntries = useQuery(
    api.projectLocksRead.currentEntries,
    open ? { projectId, orgId } : "skip",
  );

  const analysis = useMemo(() => {
    if (!sourceEntries || !currentEntries) return null;
    const before = sourceEntries as SnapshotEntryLike[];
    const after = currentEntries as SnapshotEntryLike[];
    const rows = diffSnapshotEntries(before, after);
    const unpricedCount = rows.filter(
      (r) => r.status === "added" && (r.entityType === "group" || r.entityType === "lineItem"),
    ).length;

    const beforeProject = before.find((e) => e.entityType === "project")?.data as Record<string, unknown> | undefined;
    const afterProject = after.find((e) => e.entityType === "project")?.data as Record<string, unknown> | undefined;
    const windowMoved =
      !!beforeProject &&
      !!afterProject &&
      (beforeProject.rentalStartDate !== afterProject.rentalStartDate ||
        beforeProject.rentalEndDate !== afterProject.rentalEndDate);

    return { unpricedCount, windowMoved };
  }, [sourceEntries, currentEntries]);

  async function confirm() {
    setPending(true);
    try {
      const result = await quoteWrites.repriceFromRevision(projectId, sourceQuoteId);
      toast.success(`Created v${result.version} using v${result.sourceVersion}'s pricing`);
      onDone?.(result);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reprice");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Use v{sourceVersion}&rsquo;s pricing for v{nextVersion}?
          </DialogTitle>
          <DialogDescription>
            v{nextVersion} will be created with the prices from quote v{sourceVersion}. Gear, quantities and dates are
            unchanged.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-1.5 text-sm text-warn">
          {analysis == null && <li className="text-fg-4">Checking for differences…</li>}
          {analysis && analysis.unpricedCount > 0 && (
            <li>
              <strong>{analysis.unpricedCount} item{analysis.unpricedCount === 1 ? "" : "s"} added since v{sourceVersion}</strong> have no
              price in it — they&rsquo;ll be unpriced and need one.
            </li>
          )}
          {analysis?.windowMoved && (
            <li>The rental window has changed since v{sourceVersion}, so these prices were worked out over a different duration.</li>
          )}
        </ul>

        <DialogFooter>
          <Button type="button" variant="line" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" loading={pending} onClick={() => void confirm()}>
            Create v{nextVersion} with v{sourceVersion}&rsquo;s pricing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
