"use client";

import { use } from "react";
import { useServerQuery } from "@/hooks/use-server-query";
import { Loader2 } from "lucide-react";

import { getStocktakeById } from "@/server/stocktake";
import { useActiveOrganization } from "@/lib/auth-client";
import { RequirePermission } from "@/components/auth/require-permission";
import { StocktakeForm } from "@/components/stocktake/stocktake-form";
import type { CreateStocktakeValues } from "@/lib/validations/stocktake";

export default function EditStocktakePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: stocktake, isLoading } = useServerQuery({
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

  if (stocktake.status !== "DRAFT" && stocktake.status !== "IN_PROGRESS") {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-muted-foreground">
          Only draft or in-progress stocktakes can be edited
        </p>
      </div>
    );
  }

  const initialData: CreateStocktakeValues & { id: string } = {
    id: stocktake.id as string,
    name: stocktake.name as string,
    locationId: stocktake.locationId as string,
    scope: stocktake.scope as "FULL" | "CATEGORY" | "SPOT_CHECK",
    categoryId: (stocktake.categoryId as string) || undefined,
    notes: (stocktake.notes as string) || "",
  };

  return (
    <RequirePermission resource="stocktake" action="manage">
      <div className="mx-auto max-w-3xl space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Edit Stocktake</h1>
          <p className="text-muted-foreground">{stocktake.name as string}</p>
        </div>
        <StocktakeForm initialData={initialData} />
      </div>
    </RequirePermission>
  );
}
