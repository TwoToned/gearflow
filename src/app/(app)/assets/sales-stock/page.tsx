"use client";
// use-client: interactive client route (below-the-fold interactivity) (R-8.1.1)

import { RequirePermission } from "@/components/auth/require-permission";
import { SalesStockList } from "@/components/assets/sales-stock-list";
import { FadeIn } from "@/components/ui/motion";

export default function SalesStockPage() {
  return (
    <FadeIn>
      {/* Gated on `model` (matches Fleet ROI's precedent). Adjusting stock additionally requires
          `model:update`, enforced by the verb's CanDo gate and re-checked server-side. */}
      <RequirePermission resource="model" action="read">
        <SalesStockList />
      </RequirePermission>
    </FadeIn>
  );
}
