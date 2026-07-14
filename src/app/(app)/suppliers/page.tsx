"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { SupplierTable } from "@/components/suppliers/supplier-table";
import { RequirePermission } from "@/components/auth/require-permission";
import { ListPageLayout } from "@/components/layout/page-layouts";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { FadeIn } from "@/components/ui/motion";
import { useSuppliers } from "@/hooks/use-suppliers";
import { useActiveOrganization } from "@/lib/auth-client";
import { useSupplierCounts } from "@/hooks/use-supplier-counts";
import { cn } from "@/lib/utils";

/**
 * Dashboard stat tile — RVLT card surface with a big font-display figure over a
 * muted label (Retool/Zoho metric-card-row pattern). Derived entirely client-side
 * from the suppliers list the table already loads; no new server round-trips.
 */
function StatTile({
  figure,
  label,
  className,
}: {
  figure: React.ReactNode;
  label: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--r-lg)] border-2 border-line bg-card p-4 shadow-[var(--sh-card)]",
        className,
      )}
    >
      <div className="font-display text-[28px] font-extrabold leading-none tracking-tight tabular-nums text-ink sm:text-[32px]">
        {figure}
      </div>
      <div className="mt-1.5 text-caption text-muted">{label}</div>
    </div>
  );
}

export default function SuppliersPage() {
  const router = useRouter();
  useKeyboardShortcut("n", () => router.push("/suppliers/new"));

  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  // Same reactive list + counts the SupplierTable consumes — we aggregate it
  // client-side for the dashboard tiles so there's no extra server work.
  const allSuppliers = useSuppliers(orgId);
  const supplierCounts = useSupplierCounts(orgId);

  const stats = useMemo(() => {
    const list = allSuppliers ?? [];
    const total = list.length;
    const active = list.filter((s) => (s.isActive ?? true) === true).length;
    const archived = total - active;

    let totalOrders = 0;
    let suppliersWithOrders = 0;
    for (const s of list) {
      const orders = supplierCounts?.[s.id]?.orders ?? 0;
      totalOrders += orders;
      if (orders > 0) suppliersWithOrders += 1;
    }

    return { total, active, archived, totalOrders, suppliersWithOrders };
  }, [allSuppliers, supplierCounts]);

  const loading = allSuppliers === undefined;

  return (
    <FadeIn>
      <RequirePermission resource="supplier" action="read">
        <ListPageLayout
          title="Suppliers"
          description="Vendors and suppliers you purchase or hire from."
        >
          {/* Dashboard header — metric tiles across the top, table below */}
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile figure={loading ? "–" : stats.total} label="Total suppliers" />
            <StatTile figure={loading ? "–" : stats.active} label="Active" />
            <StatTile
              figure={loading ? "–" : stats.suppliersWithOrders}
              label="With orders"
            />
            <StatTile
              figure={loading ? "–" : stats.totalOrders}
              label="Orders placed"
            />
          </div>

          <SupplierTable />
        </ListPageLayout>
      </RequirePermission>
    </FadeIn>
  );
}
