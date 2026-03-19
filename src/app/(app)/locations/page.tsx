"use client";

import { LocationTable } from "@/components/locations/location-table";
import { RequirePermission } from "@/components/auth/require-permission";

export default function LocationsPage() {
  return (
    <RequirePermission resource="location" action="read">
    <div className="space-y-4">
      <div>
        <h1 className="t-title text-fg">Locations</h1>
        <p className="text-[13px] text-fg-3">
          Warehouses, venues, vehicles, and offsite storage.
        </p>
      </div>
      <LocationTable />
    </div>
    </RequirePermission>
  );
}
