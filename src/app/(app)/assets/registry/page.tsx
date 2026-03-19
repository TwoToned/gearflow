"use client";

import { AssetTable } from "@/components/assets/asset-table";
import { RequirePermission } from "@/components/auth/require-permission";
import { ListPageLayout } from "@/components/layout/page-layouts";

export default function RegistryPage() {
  return (
    <RequirePermission resource="asset" action="read">
      <ListPageLayout
        title="Asset Registry"
        description="Every piece of gear your organisation owns, tracked individually."
      >
        <AssetTable />
      </ListPageLayout>
    </RequirePermission>
  );
}
