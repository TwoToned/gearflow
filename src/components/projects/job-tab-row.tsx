"use client";

import { TabStrip } from "@/components/ui/tab-strip";
import { useIsMobile } from "@/hooks/use-mobile";
import { JOB_TAB_PRIMARY, useJobTabCounts } from "@/components/projects/job-tab-sources";
import { jobTabItems, type JobTabKey } from "@/lib/job-tabs";

/**
 * The job page's tab row (spec §10, D92): the ONE underlined-word `TabStrip`
 * with counts (`Tasks 9/14`, `Packing 36/44`, `Versions 3`), plus the active
 * tab's primary at the right on desktop (`JOB_TAB_PRIMARY`; on a phone the
 * tab renders its own sticky bar). The strip scrolls sideways on a phone.
 */
export function JobTabRow({
  projectId,
  orgId,
  available,
  value,
  onValueChange,
}: {
  projectId: string;
  orgId: string | undefined;
  available: readonly JobTabKey[];
  value: JobTabKey;
  onValueChange: (tab: JobTabKey) => void;
}) {
  const isMobile = useIsMobile();
  const counts = useJobTabCounts(projectId);
  const Primary = isMobile ? undefined : JOB_TAB_PRIMARY[value];
  return (
    <div className="flex min-w-0 items-end gap-4 border-b border-line">
      <div className="min-w-0 flex-1">
        <TabStrip
          idPrefix="job-tab"
          aria-label="Job sections"
          items={jobTabItems(available, counts)}
          value={value}
          onValueChange={(v) => onValueChange(v as JobTabKey)}
          className="border-b-0"
        />
      </div>
      {Primary ? (
        <div className="shrink-0 pb-2">
          <Primary projectId={projectId} orgId={orgId} />
        </div>
      ) : null}
    </div>
  );
}
