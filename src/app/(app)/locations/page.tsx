"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Warehouse, Building2, Truck, MapPin, Boxes } from "lucide-react";
import { LocationTable } from "@/components/locations/location-table";
import { RequirePermission } from "@/components/auth/require-permission";
import { ListPageLayout } from "@/components/layout/page-layouts";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { FadeIn } from "@/components/ui/motion";
import { useLocations } from "@/hooks/use-locations";
import { useServerQuery } from "@/hooks/use-server-query";
import { getLocationCounts } from "@/server/locations";
import { useActiveOrganization } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

/**
 * Dashboard header for the Locations index — a strip of RVLT stat tiles derived
 * entirely client-side from the same reactive `useLocations` list + cross-domain
 * `getLocationCounts` the table already loads. No new server calls. (Retool /
 * Zoho "stats above the table" pattern, DESIGN.md §Dashboard inline metrics.)
 */
function LocationsDashboardHeader() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const locations = useLocations(orgId);
  const { data: counts } = useServerQuery({
    queryKey: ["location-counts", orgId],
    queryFn: () => getLocationCounts(),
    enabled: !!orgId,
  });

  const stats = useMemo(() => {
    const list = locations ?? [];
    const byType = { WAREHOUSE: 0, VENUE: 0, VEHICLE: 0, OFFSITE: 0 } as Record<string, number>;
    for (const l of list) {
      const t = l.type ?? "OFFSITE";
      byType[t] = (byType[t] ?? 0) + 1;
    }
    let storedAssets = 0;
    if (counts) {
      for (const v of Object.values(counts)) {
        storedAssets += (v.assets ?? 0) + (v.bulkAssets ?? 0) + (v.kits ?? 0);
      }
    }
    return { total: list.length, byType, storedAssets };
  }, [locations, counts]);

  const loading = locations === undefined;

  const tiles: Array<{ icon: typeof Warehouse; label: string; figure: number; bright?: boolean }> = [
    { icon: MapPin, label: "Total locations", figure: stats.total, bright: true },
    { icon: Warehouse, label: "Warehouses", figure: stats.byType.WAREHOUSE ?? 0 },
    { icon: Building2, label: "Venues", figure: stats.byType.VENUE ?? 0 },
    { icon: Truck, label: "Vehicles", figure: stats.byType.VEHICLE ?? 0 },
    { icon: Boxes, label: "Assets stored", figure: stats.storedAssets },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <div
            key={t.label}
            className="flex flex-col gap-2 rounded-[var(--r)] border-2 border-line bg-card p-4 shadow-[var(--sh-card)]"
          >
            <div className="flex items-center gap-2 text-muted">
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="text-caption">{t.label}</span>
            </div>
            <span
              className={cn(
                "font-display font-extrabold leading-none tracking-tight tabular-nums",
                t.bright ? "text-[32px] text-ink" : "text-[28px] text-ink-2",
                loading && "animate-pulse text-faint",
              )}
            >
              {loading ? "—" : t.figure}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function LocationsPage() {
  const router = useRouter();
  useKeyboardShortcut("n", () => router.push("/locations/new"));

  return (
    <FadeIn>
      <RequirePermission resource="location" action="read">
        <ListPageLayout
          title="Locations"
          description="Warehouses, venues, vehicles, and offsite storage."
        >
          <LocationsDashboardHeader />
          <LocationTable />
        </ListPageLayout>
      </RequirePermission>
    </FadeIn>
  );
}
