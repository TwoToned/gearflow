"use client";
// use-client: interactive client route (below-the-fold interactivity) (R-8.1.1)

import { RequirePermission } from "@/components/auth/require-permission";
import { ListPageLayout } from "@/components/layout/page-layouts";
import { FadeIn } from "@/components/ui/motion";
import { SalesStockTable } from "@/components/assets/sales-stock-table";

export default function SalesStockPage() {
  return (
    <FadeIn>
      {/* Gated on `model` (matches Fleet ROI's precedent) — restocking additionally
          requires `model:update`, enforced per-row by the table's CanDo-gated
          Restock button and re-checked server-side in adjustSaleStockNative. */}
      <RequirePermission resource="model" action="read">
        <ListPageLayout
          title="Sales Stock"
          description="The new-stock sale pool for every model — independent of rental assets/bulk. Restock it as shipments come in."
        >
          <SalesStockTable />
        </ListPageLayout>
      </RequirePermission>
    </FadeIn>
  );
}
