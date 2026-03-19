"use client";

import { ModelTable } from "@/components/assets/model-table";
import { RequirePermission } from "@/components/auth/require-permission";
import { ListPageLayout } from "@/components/layout/page-layouts";

export default function ModelsPage() {
  return (
    <RequirePermission resource="model" action="read">
      <ListPageLayout
        title="Equipment Models"
        description="Templates for your equipment — each model defines a type of gear."
      >
        <ModelTable />
      </ListPageLayout>
    </RequirePermission>
  );
}
