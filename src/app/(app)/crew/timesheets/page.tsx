"use client";

import { RequirePermission } from "@/components/auth/require-permission";
import { TimesheetsList } from "@/components/crew/workspace/timesheets/timesheets-list";
import { PageMeta } from "@/components/layout/page-meta";

/**
 * Crew › Timesheets (UX Phase 15, spec §9h.4): the Timesheets word of the
 * Crew workspace. The list, its sheets and the roles sheet live in
 * `src/components/crew/workspace/`; this route stays a deep link.
 */
export default function TimesheetsPage() {
  return (
    <RequirePermission resource="crew" action="read">
      <PageMeta title="Timesheets" />
      <TimesheetsList />
    </RequirePermission>
  );
}
