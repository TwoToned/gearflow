"use client";

import { SupplierTable } from "@/components/suppliers/supplier-table";
import { RequirePermission } from "@/components/auth/require-permission";

export default function SuppliersPage() {
  return (
    <RequirePermission resource="supplier" action="read">
      <div className="space-y-4">
        <div>
          <h1 className="t-title text-fg">Suppliers</h1>
          <p className="text-[13px] text-fg-3">
            Vendors and suppliers you purchase or hire from.
          </p>
        </div>
        <SupplierTable />
      </div>
    </RequirePermission>
  );
}
