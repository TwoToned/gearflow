"use client";

import { useRouter } from "next/navigation";
import { LocationTable } from "@/components/locations/location-table";
import { RequirePermission } from "@/components/auth/require-permission";
import { ListPageLayout } from "@/components/layout/page-layouts";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";

export default function LocationsPage() {
  const router = useRouter();
  useKeyboardShortcut("n", () => router.push("/locations/new"));

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
