"use client";

/**
 * Reservation conflict banner for the project detail page (Wave 3).
 *
 * Surfaces every double-booked asset on the project and lets the operator
 * resolve each one by swapping the conflicting line item onto a free
 * asset of the same model. Renders nothing when there are no conflicts —
 * zero noise on a clean project.
 *
 * A "conflict" is a serialized asset booked on this project AND on
 * another live project whose rental window overlaps. See
 * src/lib/reservation-conflicts.ts for the precise definition.
 */

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeftRight, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import {
  getProjectConflicts,
  getSwapCandidates,
  swapLineItemAsset,
} from "@/server/reservation-conflicts";
import type {
  ReservationConflict,
  SwapCandidate,
} from "@/lib/reservation-conflicts";
import { Button } from "@/components/ui/button";
import { showError } from "@/lib/show-error";
import { cn } from "@/lib/utils";

interface ProjectConflictsBannerProps {
  projectId: string;
}

function SwapPicker({
  conflict,
  onSwapped,
}: {
  conflict: ReservationConflict;
  onSwapped: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: candidates, isLoading } = useQuery({
    queryKey: ["swap-candidates", conflict.lineItemId],
    queryFn: () => getSwapCandidates(conflict.lineItemId),
  });

  const swapMutation = useMutation({
    mutationFn: (newAssetId: string) =>
      swapLineItemAsset(conflict.lineItemId, newAssetId),
    onSuccess: () => {
      toast.success("Asset swapped", {
        description: "The conflicting line item is now on a free asset.",
      });
      queryClient.invalidateQueries({ queryKey: ["project-conflicts"] });
      queryClient.invalidateQueries({ queryKey: ["project", conflict.modelId] });
      queryClient.invalidateQueries({ queryKey: ["swap-candidates"] });
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
            variant="outline"
            size="sm"
            className="h-7"
            disabled={swapMutation.isPending}
            onClick={() => swapMutation.mutate(c.assetId)}
          >
            {swapMutation.isPending && swapMutation.variables === c.assetId ? (
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

function ConflictRow({ conflict }: { conflict: ReservationConflict }) {
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
      {expanded && <SwapPicker conflict={conflict} onSwapped={() => setExpanded(false)} />}
    </div>
  );
}

export function ProjectConflictsBanner({ projectId }: ProjectConflictsBannerProps) {
  const { data: conflicts } = useQuery({
    queryKey: ["project-conflicts", projectId],
    queryFn: () => getProjectConflicts(projectId),
    enabled: !!projectId,
  });

  const list = (conflicts ?? []) as ReservationConflict[];
  if (list.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2",
      )}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">
          {list.length} booking conflict{list.length === 1 ? "" : "s"}
        </span>
        <span className="text-xs text-fg-3">
          — {list.length === 1 ? "this asset is" : "these assets are"} double-booked
          with an overlapping project
        </span>
      </div>
      <div className="space-y-1.5">
        {list.map((c) => (
          <ConflictRow key={c.lineItemId} conflict={c} />
        ))}
      </div>
    </div>
  );
}
