"use client";
// use-client: client navigation hooks (useRouter/useSearchParams) (R-8.1.1)

import { OverbookingsList } from "@/components/overbookings/overbookings-list";
import { RequirePermission } from "@/components/auth/require-permission";
import { FadeIn } from "@/components/ui/motion";

export default function OverbookingsPage() {
  return (
    <FadeIn>
      <RequirePermission resource="project" action="read">
        <OverbookingsList />
      </RequirePermission>
    </FadeIn>
  );
}
