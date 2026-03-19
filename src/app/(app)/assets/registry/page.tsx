"use client";

import { AssetTable } from "@/components/assets/asset-table";
import { RequirePermission } from "@/components/auth/require-permission";

export default function RegistryPage() {
  return (
    <RequirePermission resource="asset" action="read">
    <div className="space-y-4">
      <div>
        <h1 className="t-title text-fg">Asset Registry</h1>
        <p className="text-[13px] text-fg-3">
          Every piece of gear your organisation owns, tracked individually.
        </p>
      </div>
      <AssetTable />
    </div>
    </RequirePermission>
  );
}
