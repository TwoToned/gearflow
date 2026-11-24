"use client";

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
