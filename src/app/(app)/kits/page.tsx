"use client";
// use-client: client navigation hooks (useRouter/useSearchParams) (R-8.1.1)

import { KitsList } from "@/components/kits/kits-list";
import { RequirePermission } from "@/components/auth/require-permission";
import { FadeIn } from "@/components/ui/motion";

export default function KitsPage() {
  return (
    <FadeIn>
      <RequirePermission resource="kit" action="read">
        <KitsList />
      </RequirePermission>
    </FadeIn>
  );
}
