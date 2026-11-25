"use client";
// use-client: interactive client route (below-the-fold interactivity) (R-8.1.1)

import { ModelsList } from "@/components/assets/models-list";
import { RequirePermission } from "@/components/auth/require-permission";
import { FadeIn } from "@/components/ui/motion";

export default function ModelsPage() {
  return (
    <FadeIn>
      <RequirePermission resource="model" action="read">
        <ModelsList />
      </RequirePermission>
    </FadeIn>
  );
}
