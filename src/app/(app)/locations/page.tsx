"use client";
// use-client: client navigation hooks (useRouter/useSearchParams) (R-8.1.1)

import { LocationsList } from "@/components/locations/locations-list";
import { RequirePermission } from "@/components/auth/require-permission";
import { FadeIn } from "@/components/ui/motion";

export default function LocationsPage() {
  return (
    <FadeIn>
      <RequirePermission resource="location" action="read">
        <LocationsList />
      </RequirePermission>
    </FadeIn>
  );
}
