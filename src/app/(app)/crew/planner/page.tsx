import { RequirePermission } from "@/components/auth/require-permission";
import { CrewPlanner } from "@/components/crew/workspace/planner/crew-planner";
import { PageMeta } from "@/components/layout/page-meta";

/**
 * Crew › Planner (UX Phase 15, spec §9h.3): the Planner word of the Crew
 * workspace — one week, the strip, the filters and the bulk bar, all in
 * `src/components/crew/workspace/planner/`. This route stays a deep link
 * (`?week&role&avail` find-cover, `?sheet=roles` from `/crew/settings`).
 */
export default function CrewPlannerPage() {
  return (
    <RequirePermission resource="crew" action="read">
      <PageMeta title="Crew planner" />
      <CrewPlanner />
    </RequirePermission>
  );
}
