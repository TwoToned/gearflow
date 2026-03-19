"use client";

import { ModelTable } from "@/components/assets/model-table";
import { RequirePermission } from "@/components/auth/require-permission";

export default function ModelsPage() {
  return (
    <RequirePermission resource="model" action="read">
    <div className="space-y-4">
      <div>
        <h1 className="t-title text-fg">Equipment Models</h1>
        <p className="text-[13px] text-fg-3">
          Templates for your equipment — each model defines a type of gear.
        </p>
      </div>
      <ModelTable />
    </div>
    </RequirePermission>
  );
}
