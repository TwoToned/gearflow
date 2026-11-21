"use client";
// use-client: interactive — routes readiness fixes to tabs/pages (R-8.1.1)

import { useRouter } from "next/navigation";

import type { ProjectContextProject } from "@/lib/project-context";
import type { ReadinessFix } from "@/lib/project-readiness-checks";
import type { JobTabKey } from "@/lib/job-tabs";
import { ReadinessSection } from "./readiness-section";
import { QuoteMoneyLine } from "./quote-card";
import { InvoicingMoneyLine } from "./invoicing-card";
import { OverviewWhen, OverviewWhere, OverviewWho, OverviewRecent } from "./context-cards";
import { OverviewSection } from "./overview-parts";

export interface OverviewTabProject extends ProjectContextProject {
  projectNumber: string;
  status: string;
  clientId?: string | null;
  subtotal?: number | null;
  taxAmount?: number | null;
  total?: number | null;
}

/**
 * The job's home (spec §6b, UX Phase 7): one calm column, width-capped so the
 * eye has a single line to follow — readiness as a sentence and a short list,
 * two quiet money lines, When · Where · Who, then Recent. No cards, no tiles.
 *
 * The Equipment / Services / Crew / Total tiles are gone: each figure lives on
 * the tab that owns it (FEATUREDOCS/69's keep · move · remove table). A
 * template has no readiness, money or activity — only its facts.
 */
export function OverviewTab({
  projectId,
  orgId,
  project,
  isTemplate,
  onOpenTab,
  onOpenDiscussion,
}: {
  projectId: string;
  orgId: string | undefined;
  project: OverviewTabProject;
  isTemplate: boolean;
  onOpenTab: (tab: JobTabKey) => void;
  onOpenDiscussion: () => void;
}) {
  const router = useRouter();
  const onFix = (fix: ReadinessFix) => {
    if (fix.kind === "tab") onOpenTab(fix.tab);
    else if (fix.kind === "edit") router.push(`/projects/${projectId}/edit`);
    else if (fix.kind === "warehouse") router.push(`/warehouse/${projectId}`);
    else onOpenDiscussion();
  };
  const openFinance = () => onOpenTab("finance");
  const openLogistics = () => onOpenTab("labour");

  return (
    <div className="w-full min-w-0 max-w-[860px]">
      {!isTemplate && <ReadinessSection projectId={projectId} orgId={orgId} status={project.status} onFix={onFix} />}
      {!isTemplate && (
        <OverviewSection aria-label="Money" className="grid gap-5 md:grid-cols-2 md:gap-7">
          <QuoteMoneyLine
            projectId={projectId}
            orgId={orgId}
            projectNumber={project.projectNumber}
            clientId={project.clientId}
            projectStatus={project.status}
            subtotal={project.subtotal ?? null}
            taxAmount={project.taxAmount ?? null}
            total={project.total ?? null}
            onOpenFinance={openFinance}
          />
          <InvoicingMoneyLine
            projectId={projectId}
            orgId={orgId}
            projectNumber={project.projectNumber}
            projectStatus={project.status}
            clientId={project.clientId}
            total={project.total ?? null}
            onOpenFinance={openFinance}
          />
        </OverviewSection>
      )}
      <OverviewSection aria-label="When, where and who" className="grid gap-5 md:grid-cols-3 md:gap-7">
        {!isTemplate && <OverviewWhen projectId={projectId} project={project} onOpenLogistics={openLogistics} />}
        <OverviewWhere projectId={projectId} project={project} />
        <OverviewWho projectId={projectId} orgId={orgId} project={project} onOpenLogistics={openLogistics} />
      </OverviewSection>
      {!isTemplate && (
        <OverviewSection aria-label="Recent activity">
          <OverviewRecent projectId={projectId} onOpenDiscussion={onOpenDiscussion} />
        </OverviewSection>
      )}
    </div>
  );
}
