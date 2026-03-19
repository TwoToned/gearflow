"use client";

import { LocationTable } from "@/components/locations/location-table";
import { RequirePermission } from "@/components/auth/require-permission";
import { ListPageLayout } from "@/components/layout/page-layouts";

export default function LocationsPage() {
  return (
    <RequirePermission resource="location" action="read">
      <ListPageLayout
        title="Locations"
        description="Warehouses, venues, vehicles, and offsite storage."
      >
        <LocationTable />
      </ListPageLayout>
    </RequirePermission>
  );
}
