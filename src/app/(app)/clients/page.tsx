"use client";

import { ClientTable } from "@/components/clients/client-table";
import { RequirePermission } from "@/components/auth/require-permission";
import { ListPageLayout } from "@/components/layout/page-layouts";

export default function ClientsPage() {
  return (
    <RequirePermission resource="client" action="read">
      <ListPageLayout
        title="Clients"
        description="Production companies, venues, and contacts."
      >
        <ClientTable />
      </ListPageLayout>
    </RequirePermission>
  );
}
