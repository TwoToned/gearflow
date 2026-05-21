"use client";

import { StocktakeTable } from "@/components/stocktake/stocktake-table";
import { RequirePermission } from "@/components/auth/require-permission";

export default function StocktakePage() {
  return (
    <RequirePermission resource="stocktake" action="read">
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Stocktake</h1>
          <p className="text-muted-foreground">
            Verify physical inventory against system records.
          </p>
        </div>
        <StocktakeTable />
      </div>
    </RequirePermission>
  );
}
