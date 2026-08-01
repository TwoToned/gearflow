"use client";

/**
 * One double-booked asset, with the swap-to-a-free-asset action that resolves
 * it (Wave 3; re-homed by #1061).
 *
 * A "conflict" is a serialized asset booked on this project AND on another
 * live project whose rental window overlaps — see
 * `convex/reservationConflicts.ts` for the precise definition.
 *
 * This used to be a standalone amber banner above the project tabs. It now
 * renders inside the Overview tab's Readiness checklist, under the "assets
 * double-booked" check, so a conflict is one of the project's readiness
 * signals rather than a competing banner with its own heading. The row keeps
 * owning the swap: the checklist reports that a problem exists, this component
 * fixes it.
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { useConvex, useConvexAuth } from "convex/react";
import { useServerQuery } from "@/hooks/use-server-query";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { refreshProjectConflicts } from "@/hooks/use-project-conflicts";
import { useReservationSwap } from "@/hooks/use-reservation-swap";
import { api } from "../../../convex/_generated/api";
import type {
  ReservationConflict,
  SwapCandidate,
} from "@/lib/reservation-conflicts-types";
import { Button } from "@/components/ui/button";
import { showError } from "@/lib/show-error";

function SwapPicker({
  conflict,
  projectId,
  onSwapped,
}: {
  conflict: ReservationConflict;
  projectId: string;
  onSwapped: () => void;
}) {
  const [swappingId, setSwappingId] = useState<string | null>(null);
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const swap = useReservationSwap();
  const { data: candidates, isLoading } = useServerQuery({
    queryKey: ["swap-candidates", conflict.lineItemId],
    queryFn: () =>
      convex.query(api.reservationConflicts.swapCandidates, {
        lineItemId: conflict.lineItemId,
      }),
    enabled: isAuthenticated,
  });

  const swapMutation = useServerMutation({
    mutationFn: (newAssetId: string) => swap(conflict.lineItemId, newAssetId),
    onSuccess: () => {
      toast.success("Asset swapped", {
        description: "The conflicting line item is now on a free asset.",
      });
      // Refresh the parent's conflict list (the resolved row drops out); the
      // row then collapses + unmounts, so its own swap-candidates needn't refresh.
      refreshProjectConflicts(projectId);
      onSwapped();
    },
    onError: (e) => showError(e),
  });

  const list = (candidates ?? []) as SwapCandidate[];

  if (isLoading) {
    return <p className="px-2 py-2 text-xs text-fg-4">Finding free assets…</p>;
  }
  if (list.length === 0) {
    return (
      <p className="px-2 py-2 text-xs text-fg-4">
        No free {conflict.modelName} available in this window. Adjust the
        rental dates, remove the item, or add a sub-hire.
      </p>
    );
  }

  return (
    <div className="space-y-1 px-2 py-1.5">
      <p className="text-[11px] text-fg-4">Swap to a free asset:</p>
      <div className="flex flex-wrap gap-1.5">
        {list.map((c) => (
          <Button
            key={c.assetId}
            variant="line"
            size="sm"
            className="h-7"
            disabled={swapMutation.isPending}
            onClick={() => {
              setSwappingId(c.assetId);
              swapMutation.mutate(c.assetId);
            }}
          >
            {swapMutation.isPending && swappingId === c.assetId ? (
              <Loader2 className="mr-1 size-3 animate-spin" />
            ) : (
              <ArrowLeftRight className="mr-1 size-3" />
            )}
            {c.assetTag}
            {c.customName ? ` · ${c.customName}` : ""}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function ConflictRow({ conflict, projectId }: { conflict: ReservationConflict; projectId: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-md border border-amber-500/30 bg-bg-surface">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-fg-4" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-fg-4" />
        )}
        <span className="text-sm font-medium tabular-nums">{conflict.assetTag}</span>
        <span className="truncate text-xs text-fg-3">{conflict.modelName}</span>
        <span className="ml-auto shrink-0 text-xs text-fg-4">
          also on{" "}
          <Link
            href={`/projects/${conflict.conflictingProject.id}`}
            className="text-fg-2 underline-offset-2 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {conflict.conflictingProject.projectNumber}
          </Link>
        </span>
      </button>
      {expanded && <SwapPicker conflict={conflict} projectId={projectId} onSwapped={() => setExpanded(false)} />}
    </div>
  );
}

