"use client";
// use-client: RequirePermission and the list read client hooks (R-8.1.1)

import { SuppliersList } from "@/components/people/suppliers-list";
import { RequirePermission } from "@/components/auth/require-permission";
import { FadeIn } from "@/components/ui/motion";

export default function SuppliersPage() {
  return (
    <FadeIn>
      <RequirePermission resource="supplier" action="read">
        <SuppliersList />
      </RequirePermission>
    </FadeIn>
  );
}
