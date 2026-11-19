"use client";
// use-client: live Convex data via client subscription (useQuery) (R-8.1.1)

import { Suspense } from "react";
import { RequirePermission } from "@/components/auth/require-permission";
import { FloorPage } from "@/components/warehouse/floor/floor-page";

/**
 * The floor (spec §9c). A thin shell: the page reads its state from the URL
 * (D11), so it renders inside `Suspense` for `useSearchParams`.
 */
export default function WarehousePage() {
  return (
    <RequirePermission resource="warehouse" action="read">
      <Suspense fallback={null}>
        <FloorPage />
      </Suspense>
    </RequirePermission>
  );
}
