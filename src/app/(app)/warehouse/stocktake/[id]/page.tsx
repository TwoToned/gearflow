"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { getStocktakeById } from "@/server/stocktake";
import { useActiveOrganization } from "@/lib/auth-client";
import { RequirePermission } from "@/components/auth/require-permission";
import { StocktakeDraft } from "@/components/stocktake/stocktake-draft";
import { StocktakeScanner } from "@/components/stocktake/stocktake-scanner";
import { StocktakeReview } from "@/components/stocktake/stocktake-review";
import { StocktakeCompleted } from "@/components/stocktake/stocktake-completed";

export default function StocktakeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: stocktake, isLoading, refetch } = useQuery({
    queryKey: ["stocktake", orgId, id],
    queryFn: () => getStocktakeById(id),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!stocktake) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-muted-foreground">Stocktake not found</p>
      </div>
    );
  }

  return (
    <RequirePermission resource="stocktake" action="read">
      {stocktake.status === "DRAFT" && (
        <StocktakeDraft stocktake={stocktake} onUpdate={refetch} />
      )}
      {stocktake.status === "IN_PROGRESS" && (
        <StocktakeScanner stocktake={stocktake} onUpdate={refetch} />
      )}
      {stocktake.status === "REVIEWING" && (
        <StocktakeReview stocktake={stocktake} onUpdate={refetch} />
      )}
      {(stocktake.status === "COMPLETED" ||
        stocktake.status === "CANCELLED") && (
        <StocktakeCompleted stocktake={stocktake} />
      )}
    </RequirePermission>
  );
}
