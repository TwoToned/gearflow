"use client";
// use-client: interactive — React state/effects (client-only) (R-8.1.1)

import { use, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageMeta } from "@/components/layout/page-meta";
import { useProjectDetail, refreshProjectDetail } from "@/hooks/use-project-detail";
import { useMiraPageContext } from "@/hooks/use-mira-page-context";
import { EquipmentTab } from "@/components/projects/equipment-tab";
import { PackingTab } from "@/components/projects/packing-tab";
import { LogisticsTab } from "@/components/projects/logistics/logistics-tab";
import { TasksNotesTab } from "@/components/projects/tasks-notes/tasks-notes-tab";
import {
  ProjectContextRail,
  type ProjectContextRailProject,
} from "@/components/projects/project-context-rail";
import { OverviewTab, type OverviewTabProject } from "@/components/projects/overview/overview-tab";
import { DetailLayout, DetailMain, DetailSidebar } from "@/components/layout/page-layouts";
import { CoachingTip } from "@/components/onboarding/coaching-tip";
import { useActivationMilestones } from "@/hooks/use-activation-milestones";
import { useActiveOrganization } from "@/lib/auth-client";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useOptimisticProjectNotes } from "@/hooks/use-native-project-writes";
import { getProjectWindowDates } from "@/lib/project-window";
import { RequirePermission } from "@/components/auth/require-permission";
import { FadeIn } from "@/components/ui/motion";
import { ProjectVersionProvider, useProjectVersionState } from "@/components/projects/project-version-context";
import { VersionNotTrackedNote } from "@/components/projects/version-not-tracked-note";
import { VersionsTab } from "@/components/projects/versions/versions-tab";
import { VersionOverlays } from "@/components/projects/versions/version-overlays";
import { composeProjectWithVersion } from "@/lib/project-version-compose";
import { JobHeader, type JobHeaderProject } from "@/components/projects/job-header";
import { JobEditSheet } from "@/components/projects/job-edit-sheet";
import { JobTabRow } from "@/components/projects/job-tab-row";
import { FinanceTabSlot } from "@/components/projects/job-tab-slots";
import { JOB_TAB_KEYS, availableJobTabs, jobTabSection, resolveJobTab, type JobTabKey } from "@/lib/job-tabs";

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  // Phase 8 (#1004): tells Mira what the user is looking at, so a question
  // asked here is routed to THIS project without having to name it.
  useMiraPageContext({ entityType: "project", entityId: id });

  // The tab is CONTROLLED (#1061): Overview's readiness list and the header
  // (Documents ▾ → Finance) move you to the tab that owns a fix. `?tab=` deep
  // links, their aliases (`work`, `logistics`) and the keys a job can show live
  // in `src/lib/job-tabs.ts` (UX Phase 7; this was the page's `VALID_TABS`).
  // The requested value is kept as given and resolved against what THIS job
  // shows on every render, so a template (no Packing/Finance/Versions) lands on
  // Overview instead of an empty tab.
  const [requestedTab, setRequestedTab] = useState<string | null>(() => searchParams.get("tab"));
  // D3 (#1107) — the "Add <model> to it" chained hand-off deep-links here as
  // `?tab=equipment&modelId=<id>`; EquipmentTab auto-opens its add dialog
  // with that model pre-selected the one time this is set. Captured ONCE via
  // the lazy useState initializer (not read from `searchParams` on every
  // render) and the URL is scrubbed of `modelId` right after, in the effect
  // below — otherwise switching tabs away and back remounts EquipmentTab
  // (only the active panel is mounted), resetting its own one-shot ref guard
  // while the URL param is still there, popping the dialog open again on
  // every return visit for the rest of the session.
  const [autoOpenAddModelId] = useState(() => searchParams.get("modelId") ?? undefined);
  useEffect(() => {
    if (!autoOpenAddModelId) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("modelId");
    router.replace(`/projects/${id}?${params.toString()}`);
    // Runs once on mount only — re-running on searchParams changing would
    // fight the very replace() this effect just did.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // D2 (#1106): only the org's FIRST (oldest) non-template project ever
  // shows the line-item coaching tip in its Equipment tab — this is the one
  // project the "put that gear on the job" milestone (D1, #1105) tracks.
  // Skipped (no Convex subscription at all) outside the Equipment tab: an
  // adversarial review caught this query running unconditionally on every
  // tab of every project's detail page, forever, for zero visible benefit
  // outside Equipment.
  const onEquipment = resolveJobTab(requestedTab, JOB_TAB_KEYS) === "equipment";
  const activationState = useActivationMilestones(onEquipment ? orgId : undefined);

  // Project Versioning v2, Phase 5 (#1231) — computed here (not just inside
  // `ProjectVersionProvider`) so the composed object below can be built
  // BEFORE the provider's own JSX wraps the rest of the page (D32).
  const versionState = useProjectVersionState(id, orgId);
  // ⋯ › Version › Manage versions… and the `V` key open the Versions TAB (D19).
  // Stable: `useVersionsShortcut` binds `V` to it, and a fresh closure per render re-bound the key every render.
  const openVersions = useCallback(() => setRequestedTab("versions"), []);
  // The discussion lives on the Tasks & notes tab (UX Phase 10): the header ⋯ and badge and
  // Overview's blocking-discussion row all land on its Discussion section.
  const openDiscussion = useCallback(() => setRequestedTab("discussion"), []);

  const { data: project, isLoading } = useProjectDetail(id);

  // Phase 3 browser-direct: optimistic project-notes save (always native — the notes
  // are safe to optimistic; a wrong save just re-renders, nothing irreversible happens).
  const optimisticNotes = useOptimisticProjectNotes(id, orgId);
  const saveProjectNotes = (
    field: "crewNotes" | "internalNotes" | "clientNotes",
    notes: string,
  ) => optimisticNotes.save(field, notes);

  if (isLoading) {
    return <DetailPageSkeleton />;
  }

  if (!project) {
    return (
      <RequirePermission resource="project" action="read">
        <div className="rounded-[var(--r-lg)] border-l-2 border-l-t-out border border-line bg-card p-6 text-center">
          <p className="text-ui-text text-ink-2">Job not found.</p>
          <p className="mt-1 text-caption text-muted">
            It may have been deleted, or you don&apos;t have access to it.
          </p>
          <Button variant="line" size="sm" className="mt-4" asChild>
            <Link href="/projects">Back to jobs</Link>
          </Button>
        </div>
      </RequirePermission>
    );
  }

  // Project Versioning v2, Phase 5 (#1231, design §5 D32) — the "composed
  // object": the live project overlaid with the VIEWED version's own PLAN
  // FIELDS (dates, discount/tax/deposit, client/location ids, notes, type,
  // description). Every existing reader below (`getProjectWindowDates`, the
  // Finance/Notes tab slots) keeps reading a `project`-shaped object
  // unmodified — this IS the "zero edits to consumers" pattern the Phase 0
  // spike proved out. Resolved relations (client name, location object) are
  // a documented exception — see `composeProjectWithVersion`'s own comment.
  const composedProject = composeProjectWithVersion(project, versionState.viewingPlanFields);

  // Billing (FinanceTabSlot below) reads the raw rental window directly — pricing
  // never runs on the gear-committed window (see project-dates.ts).
  const rentalStart = composedProject.rentalStartDate
    ? new Date(composedProject.rentalStartDate as unknown as string)
    : null;
  const rentalEnd = composedProject.rentalEndDate
    ? new Date(composedProject.rentalEndDate as unknown as string)
    : null;
  const projectWindowStart = composedProject.projectStartDate
    ? new Date(composedProject.projectStartDate as unknown as string)
    : null;
  const projectWindowEnd = composedProject.projectEndDate
    ? new Date(composedProject.projectEndDate as unknown as string)
    : null;
  // Availability/overbooking checks (equipment tab add/edit dialogs) read the
  // gear-committed window, not the raw rental dates — see project-window.ts.
  const availabilityWindow = getProjectWindowDates({
    projectStartDate: projectWindowStart,
    projectEndDate: projectWindowEnd,
    rentalStartDate: rentalStart,
    rentalEndDate: rentalEnd,
  });

  const isTemplate = !!project.isTemplate;
  const headerProject: JobHeaderProject = {
    id,
    name: project.name,
    status: project.status,
    isTemplate,
    projectNumber: project.projectNumber,
    type: (composedProject.type as string | null | undefined) ?? null,
    client: project.client ?? null,
    rentalStartDate: (composedProject.rentalStartDate as unknown as string | null) ?? null,
    rentalEndDate: (composedProject.rentalEndDate as unknown as string | null) ?? null,
  };

  // ── Tab panels ───────────────────────────────────────────────────────────
  // One entry per tab; a tab is AVAILABLE only when it has a panel here (and
  // a template never shows Packing, Finance or Versions — `job-tabs.ts`).
  // Only the active panel is mounted, as with the old Radix `TabsContent`.
  const panels: Partial<Record<JobTabKey, React.ReactNode>> = {
    // ── Overview (#1061; UX Phase 7, §6b). The job's home: readiness, two
    // money lines, When · Where · Who, Recent — `overview/overview-tab.tsx`.
    overview: (
      <OverviewTab
        projectId={id}
        orgId={orgId}
        project={project as OverviewTabProject}
        isTemplate={isTemplate}
        onOpenTab={setRequestedTab}
        onOpenDiscussion={openDiscussion}
      />
    ),
    equipment: (
      <EquipmentTab
        projectId={id}
        rentalStartDate={availabilityWindow.start}
        rentalEndDate={availabilityWindow.end}
        autoOpenAddModelId={autoOpenAddModelId}
        versionId={versionState.viewingVersion?.id}
        versionNumber={(versionState.viewingVersion ?? versionState.liveVersion)?.number}
      />
    ),
    // Packing (#1296 build plan phase 4, D11) — plan which container each piece
    // of gear travels in; the warehouse does the actual packing. Phase 8 owns it.
    packing: <PackingTab projectId={id} orgId={orgId} versionId={versionState.viewingVersion?.id} />,
    // Logistics (value stays `labour` so old deep links keep working). Services
    // (versioned) and crew assignments (reality) both stay LIVE regardless of
    // `?v=` this phase — a documented follow-up, not silently dropped.
    labour: (
      <div className="space-y-6">
        <VersionNotTrackedNote what="Services & crew" />
        <LogisticsTab projectId={id} />
      </div>
    ),
    // Finance (#989): quote revisions + send, invoices + issue, the financial
    // summary and operational P&L. The quote/invoice PDFs are STORED bytes (#987).
    finance: (
      <div className="space-y-6">
        <FinanceTabSlot
          projectId={project.id}
          orgId={orgId}
          projectNumber={project.projectNumber}
          clientId={project.clientId as string | null | undefined}
          projectStatus={project.status as string | null | undefined}
          subtotal={project.subtotal as number | null}
          taxAmount={project.taxAmount as number | null}
          total={project.total as number | null}
          rentalStartDate={rentalStart}
          rentalEndDate={rentalEnd}
          billingWeeksOverride={project.billingWeeksOverride as number | null}
          billingDaysOverride={project.billingDaysOverride as number | null}
          categories={project.categories as { groups: { title: string; quantity: number; price: unknown }[] }[] | undefined}
          equipmentRevenue={project.equipmentRevenue as number | null}
          saleRevenue={project.saleRevenue as number | null}
          saleCostTotal={project.saleCostTotal as number | null}
          serviceCostTotal={project.serviceCostTotal as number | null}
          labourCostTotal={project.labourCostTotal as number | null}
          subHireCostTotal={project.subHireCostTotal as number | null}
          discountPercent={project.discountPercent as number | null}
          discountAmount={project.discountAmount as number | null}
          taxRate={project.taxRate as number | null}
          margin={project.margin as number | null}
        />
      </div>
    ),
    // Tasks & notes (UX Phase 10): Tasks, Notes and Files merged into one tab.
    // Tasks and Files are not in the version snapshot (stay live); the three note
    // fields ARE captured, so a viewed version shows its own text, read-only.
    tasks: (
      <TasksNotesTab
        projectId={id}
        orgId={orgId}
        section={jobTabSection(requestedTab)}
        onOpenTab={setRequestedTab}
        composedNotes={{
          crewNotes: (composedProject.crewNotes as string) || "",
          internalNotes: (composedProject.internalNotes as string) || "",
          clientNotes: (composedProject.clientNotes as string) || "",
        }}
        onSaveNote={saveProjectNotes}
      />
    ),
    // Versions (D19, UX Phase 8): the dated list; Compare and Make live open the
    // sheet and dialog `VersionOverlays` hosts.
    versions: <VersionsTab projectId={id} orgId={orgId} />,
  };
  const available = availableJobTabs({ isTemplate, panels: new Set(Object.keys(panels) as JobTabKey[]) });
  const activeTab = resolveJobTab(requestedTab, available);

  return (
    <RequirePermission resource="project" action="read">
      <PageMeta title={`${project.projectNumber} ${project.name}`} />
      <FadeIn>
        <ProjectVersionProvider value={versionState}>
        <div className="space-y-6">
          {/* UX Phase 7 (§6b, D92): the calm header replaces the hero card,
              the lifecycle stepper, the lock chip and the lock strip. The
              shell's breadcrumb trail (`PageMeta`) replaces the hero's own. */}
          <JobHeader
            project={headerProject}
            orgId={orgId}
            onOpenTab={setRequestedTab}
            onOpenVersions={openVersions}
            onMakeLive={versionState.openMakeLive}
            onOpenDiscussion={openDiscussion}
          />

          {/* ── Tabs + context sidebar ───────────────────────────────────────
              #1063: the sidebar (Schedule · Location · Team · Activity) rides
              along on every tab EXCEPT Overview, which composes the same facts
              itself; rendering both would show them twice on one tab.
              Compare is a read-only SHEET (D20), hosted by `VersionOverlays`
              below, so the tabs stay on screen. */}
          <DetailLayout>
            <DetailMain>
              <JobTabRow
                projectId={id}
                orgId={orgId}
                available={available}
                value={activeTab}
                onValueChange={setRequestedTab}
              />
              <div role="tabpanel" id={`job-tabpanel-${activeTab}`} aria-labelledby={`job-tab-${activeTab}`} className="pt-4">
                {panels[activeTab]}
              </div>
            </DetailMain>

            {activeTab !== "overview" && (
              <DetailSidebar>
                {/* D2 (#1106): coaching for the "put that gear on the job"
                    milestone — only on the ONE project it tracks. CoachingTip
                    checks the milestone itself and renders nothing once done. */}
                {activeTab === "equipment" && activationState?.firstProjectId === id && (
                  <CoachingTip orgId={orgId} milestoneKey="lineItem" fallbackEyebrow="" fallbackTip="" hideWhenInactive />
                )}
                <ProjectContextRail
                  projectId={id}
                  orgId={orgId}
                  project={project as ProjectContextRailProject}
                />
              </DetailSidebar>
            )}
          </DetailLayout>

          {/* The ONE Compare sheet and ONE Make-live dialog, for every entry point (R-3.1). */}
          {!isTemplate && orgId && <VersionOverlays />}
          <JobEditSheet projectId={id} />
        </div>
        </ProjectVersionProvider>
      </FadeIn>
    </RequirePermission>
  );
}
