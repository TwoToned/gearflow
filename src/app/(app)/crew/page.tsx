"use client";

import { CrewList } from "@/components/people/crew-list";
import { RequirePermission } from "@/components/auth/require-permission";
import { FadeIn } from "@/components/ui/motion";

/**
 * The Crew landing page is the list (UX Phase 13, D38): the manager dashboard is
 * dissolved into strip counts, the page ⋯ (Timesheets, Planner, roles & rates, Log time,
 * Export) and the Timesheets surface that already owns approval.
 */
export default function CrewPage() {
  return (
    <FadeIn>
      <RequirePermission resource="crew" action="read">
        <CrewList />
      </RequirePermission>
    </FadeIn>
  );
}
