"use client";

import Link from "next/link";
import {
  CheckCircle2,
  AlertTriangle,
  MapPin,
  ArrowLeft,
  Ban,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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

interface StocktakeCompletedProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stocktake: Record<string, any>;
}

export function StocktakeCompleted({ stocktake }: StocktakeCompletedProps) {
  const isCancelled = stocktake.status === "CANCELLED";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: Record<string, any>[] = stocktake.items ?? [];
  const discrepancies = items.filter((i) => i.result !== "MATCH");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {isCancelled ? (
          <Ban className="h-6 w-6 text-red-500" />
        ) : (
          <CheckCircle2 className="h-6 w-6 text-green-500" />
        )}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {stocktake.name}
          </h1>
          <p className="text-muted-foreground">
            {isCancelled
              ? "This stocktake was cancelled."
              : `Completed on ${new Date(stocktake.completedAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}`}
          </p>
        </div>
      </div>

      {/* Summary cards */}
      {!isCancelled && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
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
              <p className="text-2xl font-bold text-red-500">
                {stocktake.missingCount}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Unexpected</p>
              <p className="text-2xl font-bold text-amber-500">
                {stocktake.unexpectedCount}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs text-muted-foreground">Accuracy</p>
              <p className="text-2xl font-bold">
                {stocktake.expectedCount > 0
                  ? Math.round(
                      ((stocktake.expectedCount - stocktake.missingCount) /
                        stocktake.expectedCount) *
                        100,
                    )
                  : 100}
                %
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Details */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <span>
              <span className="font-medium">Location:</span>{" "}
              {stocktake.location?.name}
            </span>
          </div>
          {stocktake.startedBy && (
            <div>
              <span className="font-medium">Started by:</span>{" "}
              {stocktake.startedBy.name}
            </div>
          )}
          {stocktake.reviewedBy && (
            <div>
              <span className="font-medium">Reviewed by:</span>{" "}
              {stocktake.reviewedBy.name}
            </div>
          )}
          {stocktake.notes && (
            <div>
              <span className="font-medium">Notes:</span>{" "}
              <span className="text-muted-foreground">{stocktake.notes}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Discrepancies table */}
      {discrepancies.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Discrepancies ({discrepancies.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {discrepancies.map((item) => {
                const assetTag =
                  item.asset?.assetTag ??
                  item.bulkAsset?.assetTag ??
                  "Unknown";
                const modelName =
                  item.asset?.model?.name ??
                  item.bulkAsset?.model?.name ??
                  "";

                return (
                  <div key={item.id} className="flex items-center gap-3 py-2">
                    {item.result === "MISSING" ? (
                      <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {assetTag}
                        </span>
                        <Badge
                          variant="outline"
                          className={resultColors[item.result] ?? ""}
                        >
                          {resultLabels[item.result] ?? item.result}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {modelName}
                      </p>
                    </div>
                    {item.actionTaken && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {item.actionTaken}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Button
        variant="outline"
        render={<Link href="/warehouse/stocktake" />}
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Stocktakes
      </Button>
    </div>
  );
}
