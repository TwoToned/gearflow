"use client";
// use-client: reads the URL's tab and the viewer's permissions (R-8.1.1)

import { Suspense } from "react";

import { RequirePermission } from "@/components/auth/require-permission";
import { FinanceHub } from "@/components/finance/finance-hub";
import { Skeleton } from "@/components/ui/skeleton";

/** The org Finance hub (UX Phase 17, §9j): Quotes and Invoices on `ListPage`; FEATUREDOCS/66. */
export default function FinancePage() {
  return (
    <RequirePermission resource="invoice" action="read">
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <FinanceHub />
      </Suspense>
    </RequirePermission>
  );
}
