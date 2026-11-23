"use client";

import { useMemo, useState } from "react";

import { ActionMenu } from "@/components/ui/action-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusWord } from "@/components/ui/status-word";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCanDo } from "@/lib/use-permissions";
import { buildVersionRowActions } from "@/lib/row-actions/version-row";
import { formatCurrency } from "@/lib/formatters";
import { versionDate, versionDiffLine, versionFactLine, versionTitle, type VersionRowFacts } from "@/lib/versions-tab";
import { cn } from "@/lib/utils";
import { api } from "../../../../convex/_generated/api";
import { useProjectVersion, type ProjectVersionSummary } from "@/components/projects/project-version-context";
import { RenameVersionDialog, SaveVersionDialog } from "@/components/projects/versions/version-dialogs";
import { VersionsTabPrimary } from "@/components/projects/versions/versions-tab-primary";
import { useProjectVersionWrites } from "@/hooks/use-project-version-writes";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { showError } from "@/lib/show-error";
import { toast } from "sonner";

/**
 * The Versions tab (UX Phase 8, D19; spec §7b.4): a dated list in the
 * Discussion rendering, newest first. Each row is mono date · `v3 · Live` ·
 * name · `● Live` / `● Viewing`, one fact line (`44 lines · 36 planned · quote
 * sent`), one derived diff line vs the previous version, and the total on the
 * right. No cards. Clicking a row OPENS (views) that version; the row ⋯ holds
 * the verbs (`buildVersionRowActions`). The facts come from ONE bounded read
 * (`versionsPreview.versionRowFacts`, newest few versions); a row without facts
 * still renders its title and date.
 *
 * The primary, `Save as new version`, sits in the tab row (`JOB_TAB_PRIMARY`);
 * a phone gets its red sticky bar here. Make live and Compare open the ONE
 * dialog and the ONE sheet that `VersionOverlays` hosts.
 */
export function VersionsTab({ projectId, orgId }: { projectId: string; orgId: string | undefined }) {
  const isMobile = useIsMobile();
  const ctx = useProjectVersion();
  const { versions, liveVersion, viewingNumber, setViewingNumber, openCompare, openMakeLive } = ctx;
  const canPublish = useCanDo("invoice", "publish");
  const factsRead = useAuthedQuery(api.versionsPreview.versionRowFacts, orgId ? { organizationId: orgId, projectId } : "skip");
  const factsById = useMemo(() => new Map<string, VersionRowFacts>((factsRead?.rows ?? []).map((r) => [r.versionId, r])), [factsRead]);

  const [renameTarget, setRenameTarget] = useState<ProjectVersionSummary | null>(null);
  const [copyFrom, setCopyFrom] = useState<ProjectVersionSummary | null>(null);
  const { deleteVersion } = useProjectVersionWrites(projectId);
  const remove = useServerMutation({
    mutationFn: (v: ProjectVersionSummary) => deleteVersion(v.id),
    onSuccess: (r) => toast.success(`Deleted v${r.number}`),
    onError: (e: Error) => showError(e, { fallbackTitle: "Couldn't delete" }),
  });

  const ordered = useMemo(() => [...versions].sort((a, b) => b.number - a.number), [versions]);
  const newestDraft = ordered.find((v) => !v.isLive);

  if (ordered.length === 0) {
    return <EmptyState title="No versions yet" description="A version is saved when the job is created. Save another to try a different plan." />;
  }

  const compareWith = (v: ProjectVersionSummary): ProjectVersionSummary | null => {
    if (!liveVersion || ordered.length < 2) return null;
    if (!v.isLive) return liveVersion;
    return ordered.find((x) => x.number === viewingNumber && !x.isLive) ?? newestDraft ?? null;
  };

  const rowMenu = (v: ProjectVersionSummary) => {
    const other = compareWith(v);
    return buildVersionRowActions(
      v,
      { canPublish, onScreen: v.isLive ? viewingNumber == null : v.number === viewingNumber, compareWith: other?.number ?? null },
      {
        open: () => setViewingNumber(v.isLive ? null : v.number),
        makeLive: () => openMakeLive(v),
        compare: () => other && openCompare({ kind: "version", number: null }, { kind: "version", number: v.isLive ? other.number : v.number }),
        rename: () => setRenameTarget(v),
        saveCopy: () => setCopyFrom(v),
        remove: () => remove.mutate(v),
      },
    );
  };

  return (
    <div className={cn(isMobile && "pb-24")}>
      <ul aria-label="Versions" className="divide-y divide-line">
        {ordered.map((v) => (
          <VersionRow
            key={v.id}
            v={v}
            facts={factsById.get(v.id)}
            viewing={v.isLive ? viewingNumber == null : v.number === viewingNumber}
            onOpen={() => setViewingNumber(v.isLive ? null : v.number)}
            menu={rowMenu(v)}
          />
        ))}
      </ul>
      {factsRead?.truncated ? <p className="pt-3 text-caption text-muted">Line, planned and money facts are shown for the newest versions only.</p> : null}
      {isMobile ? <VersionsTabPrimary projectId={projectId} sticky /> : null}

      <RenameVersionDialog target={renameTarget} projectId={projectId} onClose={() => setRenameTarget(null)} />
      <SaveVersionDialog
        open={copyFrom != null}
        onOpenChange={(o) => !o && setCopyFrom(null)}
        projectId={projectId}
        fromVersion={copyFrom}
        onSaved={(created) => setViewingNumber(created.number)}
      />
    </div>
  );
}

function VersionRow({
  v,
  facts,
  viewing,
  onOpen,
  menu,
}: {
  v: ProjectVersionSummary;
  facts: VersionRowFacts | undefined;
  viewing: boolean;
  onOpen: () => void;
  menu: ReturnType<typeof buildVersionRowActions>;
}) {
  const factLine = versionFactLine(v, facts);
  const diffLine = versionDiffLine(facts?.diff ?? null);
  return (
    <li className="flex min-h-16 items-center gap-2 py-2 md:min-h-[56px]">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${versionTitle(v)}`}
        aria-current={viewing ? "true" : undefined}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-[var(--r)] px-1 text-left hover:bg-elev/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red"
      >
        <span className="t-mono hidden w-24 shrink-0 text-muted md:block">{versionDate(v.createdAt)}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2">
            <span className={cn("truncate text-ui-text text-ink", v.isLive && "font-semibold")}>{versionTitle(v)}</span>
            {v.isLive ? <StatusWord status={{ label: "Live", intent: "success" }} className="text-caption" /> : null}
            {viewing && !v.isLive ? <StatusWord status={{ label: "Viewing", intent: "info" }} className="text-caption" /> : null}
          </span>
          <span className="block truncate text-caption text-muted">
            <span className="md:hidden">{versionDate(v.createdAt)}{factLine ? " · " : ""}</span>
            {factLine}
          </span>
          {diffLine ? <span className="block truncate text-caption text-muted">{diffLine}</span> : null}
        </span>
        {/* Money facts exist for the newest few versions only; the rest print a dash, never a guess. */}
        <span className="t-mono shrink-0 text-ink">{facts ? formatCurrency(facts.total, undefined, { cents: false }) : "—"}</span>
      </button>
      <ActionMenu spec={menu} label={`v${v.number} actions`} />
    </li>
  );
}
