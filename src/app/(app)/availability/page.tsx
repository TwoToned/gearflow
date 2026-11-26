import { Suspense } from "react";

import { RequirePermission } from "@/components/auth/require-permission";
import { PageMeta } from "@/components/layout/page-meta";
import { SchedulePage } from "@/components/schedule/schedule-page";

/**
 * Schedule (UX Phase 18, spec §9o, FEATUREDOCS/11): the route stays
 * `/availability` (D7). Everything lives in `src/components/schedule/`. The
 * read is `scheduleBoard.jobs` (project:read), so both permissions gate it.
 */
export default function AvailabilityPage() {
  return (
    <RequirePermission resource="asset" action="read">
      <RequirePermission resource="project" action="read">
        <PageMeta title="Schedule" />
        <Suspense>
          <SchedulePage />
        </Suspense>
      </RequirePermission>
    </RequirePermission>
  );
}
