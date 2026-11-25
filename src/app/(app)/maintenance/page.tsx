"use client";
// use-client: client navigation hooks (useRouter/useSearchParams) (R-8.1.1)

import { MaintenanceList } from "@/components/maintenance/maintenance-list";
import { RequirePermission } from "@/components/auth/require-permission";
import { FadeIn } from "@/components/ui/motion";

export default function MaintenancePage() {
  return (
    <FadeIn>
      <RequirePermission resource="maintenance" action="read">
        <MaintenanceList />
      </RequirePermission>
    </FadeIn>
  );
}
