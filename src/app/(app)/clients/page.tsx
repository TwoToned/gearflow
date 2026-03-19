"use client";

import { ClientTable } from "@/components/clients/client-table";
import { RequirePermission } from "@/components/auth/require-permission";

export default function ClientsPage() {
  return (
    <RequirePermission resource="client" action="read">
    <div className="space-y-4">
      <div>
        <h1 className="t-title text-fg">Clients</h1>
        <p className="text-[13px] text-fg-3">
          Production companies, venues, and contacts.
        </p>
      </div>
      <ClientTable />
    </div>
    </RequirePermission>
  );
}
