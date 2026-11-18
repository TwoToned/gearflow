"use client";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { JobTable } from "@/components/warehouse/job/job-table";
import { StageActionBar } from "@/components/warehouse/job/stage-action-bar";
import type { ActionMenuSpec, RowFlag, RowSelection } from "@/lib/primitives/types";
import type { JobSection } from "@/lib/warehouse-job-rows";

export interface StageAction {
  key: string;
  label: string;
  run: () => void;
  /** The one forward verb is `primary`; moves back / sideways are `line`. */
  primary?: boolean;
  loading?: boolean;
  disabled?: boolean;
}

/**
 * The Prepped and Out bodies (spec §9.2): one JobTable (case sections), the ticked-row action bar, and the
 * stage's own extras (return condition, notes) as `children`. Verbs are absent with nothing ticked, never
 * disabled-and-listed.
 */
export function MovingStage({
  sections, selection, actions, empty, sectionMenu, sectionFlags, children,
}: {
  sections: JobSection[];
  selection: RowSelection;
  actions: StageAction[];
  empty: { title: string; description: string };
  sectionMenu?: (s: JobSection) => ActionMenuSpec | undefined;
  sectionFlags?: (s: JobSection) => RowFlag[];
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3" data-testid="moving-stage">
      {children}
      {sections.length === 0 ? (
        <EmptyState title={empty.title} description={empty.description} />
      ) : (
        <JobTable sections={sections} selection={selection} sectionMenu={sectionMenu} sectionFlags={sectionFlags} />
      )}
      <StageActionBar selection={selection}>
        {actions.map((a) => (
          <Button key={a.key} size="sm" variant={a.primary ? "primary" : "line"} disabled={a.disabled} loading={a.loading} onClick={a.run}>
            {a.label} ({selection.count})
          </Button>
        ))}
      </StageActionBar>
    </div>
  );
}
