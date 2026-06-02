"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  Check,
  Eye,
  Loader2,
  MapPin,
  Hash,
  Ban,
  PackageX,
} from "lucide-react";
import { toast } from "sonner";

import {
  resolveDiscrepancy,
  bulkResolveDiscrepancies,
  completeStocktake,
  resumeScanning,
} from "@/server/stocktake";
import { useActiveOrganization } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const resultLabels: Record<string, string> = {
  MATCH: "Match",
  MISSING: "Missing",
  UNEXPECTED: "Unexpected",
  QUANTITY_MISMATCH: "Qty Mismatch",
  WRONG_LOCATION: "Wrong Location",
};

const resultColors: Record<string, string> = {
  MATCH: "bg-green-500/10 text-green-500 border-green-500/20",
  MISSING: "bg-red-500/10 text-red-500 border-red-500/20",
  UNEXPECTED: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  QUANTITY_MISMATCH: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  WRONG_LOCATION: "bg-purple-500/10 text-purple-500 border-purple-500/20",
};

type FilterType = "ALL" | "MISSING" | "UNEXPECTED" | "QUANTITY_MISMATCH" | "WRONG_LOCATION";

interface StocktakeReviewProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stocktake: Record<string, any>;
  onUpdate: () => void;
}

export function StocktakeReview({ stocktake, onUpdate }: StocktakeReviewProps) {
  const [filter, setFilter] = useState<FilterType>("ALL");
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: ["stocktake", orgId, stocktake.id],
    });
  };

  const resolveMutation = useMutation({
    mutationFn: resolveDiscrepancy,
    onSuccess: () => {
      toast.success("Discrepancy resolved");
      invalidate();
      onUpdate();
    },
    onError: (e) => toast.error(e.message),
  });

  const bulkResolveMutation = useMutation({
    mutationFn: bulkResolveDiscrepancies,
    onSuccess: () => {
      toast.success("Bulk action applied");
      invalidate();
      onUpdate();
    },
    onError: (e) => toast.error(e.message),
  });

  const completeMutation = useMutation({
    mutationFn: () => completeStocktake(stocktake.id),
    onSuccess: () => {
      toast.success("Stocktake completed");
      onUpdate();
    },
    onError: (e) => toast.error(e.message),
  });

  const resumeMutation = useMutation({
    mutationFn: () => resumeScanning(stocktake.id),
    onSuccess: () => {
      toast.success("Resumed scanning");
      onUpdate();
    },
    onError: (e) => toast.error(e.message),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allItems: Record<string, any>[] = stocktake.items ?? [];
  const discrepancies = allItems.filter(
    (i) => i.result !== "MATCH",
  );
  const filteredItems =
    filter === "ALL"
      ? discrepancies
      : discrepancies.filter((i) => i.result === filter);

  const missingCount = discrepancies.filter(
    (i) => i.result === "MISSING",
  ).length;
  const unexpectedCount = discrepancies.filter(
    (i) => i.result === "UNEXPECTED" || i.result === "WRONG_LOCATION",
  ).length;
  const qtyMismatchCount = discrepancies.filter(
    (i) => i.result === "QUANTITY_MISMATCH",
  ).length;
  const unresolvedCount = discrepancies.filter(
    (i) => !i.actionTaken,
  ).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {stocktake.name}
        </h1>
        <p className="text-muted-foreground">
          Review discrepancies and apply corrections.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Expected</p>
            <p className="text-2xl font-bold">{stocktake.expectedCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Found</p>
            <p className="text-2xl font-bold text-green-500">
              {stocktake.foundCount}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Missing</p>
            <p className="text-2xl font-bold text-red-500">{missingCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Unexpected</p>
            <p className="text-2xl font-bold text-amber-500">
              {unexpectedCount}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            { key: "ALL", label: `All (${discrepancies.length})` },
            { key: "MISSING", label: `Missing (${missingCount})` },
            {
              key: "UNEXPECTED",
              label: `Unexpected (${unexpectedCount})`,
            },
            {
              key: "QUANTITY_MISMATCH",
              label: `Qty Mismatch (${qtyMismatchCount})`,
            },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
              filter === tab.key
                ? "border-primary bg-primary/10 text-primary"
                : "border-input hover:bg-accent"
            }`}
            onClick={() => setFilter(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Bulk actions */}
      {missingCount > 0 && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              bulkResolveMutation.mutate({
                stocktakeId: stocktake.id,
                action: "MARK_ALL_MISSING_LOST",
              })
            }
            disabled={bulkResolveMutation.isPending}
          >
            {bulkResolveMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <PackageX className="mr-2 h-4 w-4" />
            )}
            Mark All Missing as Lost
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              bulkResolveMutation.mutate({
                stocktakeId: stocktake.id,
                action: "IGNORE_ALL_MISSING",
              })
            }
            disabled={bulkResolveMutation.isPending}
          >
            <Eye className="mr-2 h-4 w-4" />
            Ignore All Missing
          </Button>
        </div>
      )}

      {/* Discrepancy list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Discrepancies ({filteredItems.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredItems.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {filter === "ALL"
                ? "No discrepancies found — all items match!"
                : "No items match this filter."}
            </p>
          ) : (
            <div className="divide-y">
              {filteredItems.map((item) => (
                <DiscrepancyRow
                  key={item.id}
                  item={item}
                  onResolve={(action, note) =>
                    resolveMutation.mutate({
                      itemId: item.id,
                      action,
                      note,
                    })
                  }
                  isPending={resolveMutation.isPending}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          size="lg"
          onClick={() => resumeMutation.mutate()}
          disabled={resumeMutation.isPending}
        >
          {resumeMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Camera className="mr-2 h-5 w-5" />
          )}
          Resume Scanning
        </Button>
        <Button
          className="flex-1"
          size="lg"
          onClick={() => completeMutation.mutate()}
          disabled={completeMutation.isPending || unresolvedCount > 0}
        >
          {completeMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Check className="mr-2 h-5 w-5" />
          )}
          Complete Stocktake
          {unresolvedCount > 0 && (
            <span className="ml-2 text-xs opacity-70">
              ({unresolvedCount} unresolved)
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}

function DiscrepancyRow({
  item,
  onResolve,
  isPending,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item: Record<string, any>;
  onResolve: (
    action: "MARK_LOST" | "UPDATE_LOCATION" | "ADJUST_QUANTITY" | "IGNORE",
    note?: string,
  ) => void;
  isPending: boolean;
}) {
  const [note, setNote] = useState("");
  const assetTag =
    item.asset?.assetTag ?? item.bulkAsset?.assetTag ?? "Unknown";
  const modelName =
    item.asset?.model?.name ?? item.bulkAsset?.model?.name ?? "";
  const isResolved = !!item.actionTaken;

  return (
    <div className="flex flex-col gap-2 py-3 md:flex-row md:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{assetTag}</span>
          <Badge
            variant="outline"
            className={resultColors[item.result] ?? ""}
          >
            {resultLabels[item.result] ?? item.result}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground truncate">{modelName}</p>
        {item.bulkAssetId && (
          <p className="text-xs text-muted-foreground">
            Expected: {item.expectedQuantity} | Found: {item.foundQuantity}
          </p>
        )}
        {isResolved && (
          <p className="text-xs text-green-500 mt-1">
            <Check className="inline h-3 w-3 mr-1" />
            {item.actionTaken}
          </p>
        )}
      </div>

      {!isResolved && (
        <div className="flex items-center gap-2 shrink-0">
          <Input
            placeholder="Note..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="h-8 w-32 text-xs"
          />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm" disabled={isPending}>
                  Action
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Resolve</DropdownMenuLabel>
                {item.result === "MISSING" && (
                  <DropdownMenuItem
                    onSelect={() => onResolve("MARK_LOST", note)}
                  >
                    <PackageX className="mr-2 h-4 w-4" />
                    Mark as Lost
                  </DropdownMenuItem>
                )}
                {(item.result === "UNEXPECTED" ||
                  item.result === "WRONG_LOCATION") && (
                  <DropdownMenuItem
                    onSelect={() => onResolve("UPDATE_LOCATION", note)}
                  >
                    <MapPin className="mr-2 h-4 w-4" />
                    Update Location
                  </DropdownMenuItem>
                )}
                {item.result === "QUANTITY_MISMATCH" && (
                  <DropdownMenuItem
                    onSelect={() => onResolve("ADJUST_QUANTITY", note)}
                  >
                    <Hash className="mr-2 h-4 w-4" />
                    Adjust Quantity
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={() => onResolve("IGNORE", note)}
                >
                  <Ban className="mr-2 h-4 w-4" />
                  Ignore
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
