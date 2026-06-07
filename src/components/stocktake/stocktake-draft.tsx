"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import {
  MapPin,
  Package,
  Pencil,
  Play,
  X,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { startStocktake, cancelStocktake } from "@/server/stocktake";
import { Button } from "@/components/ui/button";

const scopeLabels: Record<string, string> = {
  FULL: "Full Warehouse",
  CATEGORY: "Category",
  SPOT_CHECK: "Spot Check",
};

interface StocktakeDraftProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stocktake: Record<string, any>;
  onUpdate: () => void;
}

export function StocktakeDraft({ stocktake, onUpdate }: StocktakeDraftProps) {
  const router = useRouter();

  const startMutation = useMutation({
    mutationFn: () => startStocktake(stocktake.id),
    onSuccess: () => {
      toast.success("Stocktake started");
      onUpdate();
    },
    onError: (e) => toast.error(e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelStocktake(stocktake.id),
    onSuccess: () => {
      toast.success("Stocktake cancelled");
      router.push("/warehouse/stocktake");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {stocktake.name}
        </h1>
        <p className="text-muted-foreground">
          Draft stocktake — ready to start scanning.
        </p>
      </div>

      <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6 space-y-3">
        <h3 className="t-heading text-fg">Stocktake Details</h3>
          <div className="flex items-center gap-2 text-sm">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">Location:</span>
            <span>{stocktake.location?.name}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">Scope:</span>
            <span>{scopeLabels[stocktake.scope] ?? stocktake.scope}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">Expected items:</span>
            <span>{stocktake.expectedCount}</span>
          </div>
          {stocktake.notes && (
            <div className="text-sm">
              <span className="font-medium">Notes:</span>{" "}
              <span className="text-muted-foreground">{stocktake.notes}</span>
            </div>
          )}
      </div>

      <div className="flex gap-2">
        <Button
          onClick={() => startMutation.mutate()}
          disabled={startMutation.isPending}
        >
          {startMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          Start Stocktake
        </Button>
        <Button
          variant="outline"
          render={<Link href={`/warehouse/stocktake/${stocktake.id}/edit`} />}
        >
          <Pencil className="mr-2 h-4 w-4" />
          Edit
        </Button>
        <Button
          variant="outline"
          onClick={() => cancelMutation.mutate()}
          disabled={cancelMutation.isPending}
        >
          {cancelMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <X className="mr-2 h-4 w-4" />
          )}
          Cancel
        </Button>
      </div>
    </div>
  );
}
