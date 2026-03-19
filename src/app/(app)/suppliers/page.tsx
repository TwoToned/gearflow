"use client";

import { SupplierTable } from "@/components/suppliers/supplier-table";
import { RequirePermission } from "@/components/auth/require-permission";
import { ListPageLayout } from "@/components/layout/page-layouts";

export default function SuppliersPage() {
  return (
    <RequirePermission resource="supplier" action="read">
      <ListPageLayout
        title="Suppliers"
        description="Vendors and suppliers you purchase or hire from."
      >
        <SupplierTable />
      </ListPageLayout>
    </RequirePermission>
  );
}
