"use client";

import * as React from "react";

import { ActionMenu } from "@/components/ui/action-menu";
import { NoteCard } from "@/components/projects/tasks-notes/note-card";
import { useProjectVersion } from "@/components/projects/project-version-context";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useIsViewer } from "@/lib/use-permissions";
import type { ActionItem } from "@/lib/primitives/types";
import { cn, focusRing } from "@/lib/utils";
import { api } from "../../../../convex/_generated/api";

/**
 * The Notes section (UX Phase 10, spec §8c): three cards with their AUDIENCE on the
 * label (what prints where), saved on blur or ⌘↵. A version menu (`v3 · live ▾`)
 * shows the notes as captured in an earlier version, read-only, instead of swapping the
 * whole tab. The `Saved · Sam · date` lines are derived from the Activity events the
 * note saves write (`collaboration.lastNoteSaves`); no stored `updatedBy`.
 */
type Field = "crewNotes" | "internalNotes" | "clientNotes";
export interface NoteValues {
  crewNotes: string;
  internalNotes: string;
  clientNotes: string;
}

const CARDS: { field: Field; title: string; audience: string; previewable?: boolean }[] = [
  { field: "clientNotes", title: "Client notes", audience: "prints on the quote & invoice", previewable: true },
  { field: "crewNotes", title: "Crew notes", audience: "prints on the call sheet & runsheet" },
  { field: "internalNotes", title: "Internal notes", audience: "only us · never printed" },
];

/** The version whose notes are on screen, and whether they can be edited. */
function useNotesVersion(composed: NoteValues, projectId: string, orgId: string | undefined) {
  const { versions, isViewingVersion, viewingVersion } = useProjectVersion();
  const live = versions.find((v) => v.isLive);
  const [pickedId, setPickedId] = React.useState<string | null>(null);
  const composedId = viewingVersion?.id ?? live?.id;
  const shownId = pickedId ?? composedId;
  // The page already holds the composed notes for the version it shows; only another version is fetched.
  const fetchId = shownId && shownId !== composedId ? shownId : undefined;
  const fetched = useAuthedQuery(api.versionsRead.getVersion, orgId && fetchId ? { organizationId: orgId, projectId, versionId: fetchId } : "skip");
  const planFields = fetchId ? ((fetched?.planFields ?? null) as Partial<NoteValues> | null) : composed;
  const values: NoteValues | null = planFields ? { crewNotes: planFields.crewNotes ?? "", internalNotes: planFields.internalNotes ?? "", clientNotes: planFields.clientNotes ?? "" } : null;
  const shown = versions.find((v) => v.id === shownId);
  return {
    values,
    shown,
    versions,
    pick: setPickedId,
    editable: !isViewingVersion && (!shownId || shownId === live?.id),
  };
}

export function NotesSection({
  projectId,
  orgId,
  composed,
  onSave,
}: {
  projectId: string;
  orgId: string | undefined;
  /** The notes the page shows (the viewed version's when one is open). */
  composed: NoteValues;
  onSave: (field: Field, text: string) => Promise<unknown>;
}) {
  const isViewer = useIsViewer();
  const { values, shown, versions, pick, editable: versionEditable } = useNotesVersion(composed, projectId, orgId);
  const saves = useAuthedQuery(api.collaboration.lastNoteSaves, orgId ? { orgId, projectId } : "skip");
  const editable = versionEditable && !isViewer;

  const items: ActionItem[] = versions.map((v) => ({
    key: v.id,
    label: `v${v.number}${v.label ? ` · ${v.label}` : ""}${v.isLive ? " · live" : ""}`,
    group: "edit" as const,
    onSelect: () => pick(v.id),
  }));
  const label = shown ? `v${shown.number}${shown.isLive ? " · live" : ""}` : null;

  return (
    <div className="space-y-5">
      {versions.length > 1 && label && (
        <div className="flex items-center gap-2 text-caption text-muted">
          <ActionMenu
            spec={{ items }}
            label="Show notes as captured in a version"
            trigger={
              <button type="button" className={cn("rounded-sm hover:text-ink hover:underline", focusRing)}>
                {label} ▾
              </button>
            }
          />
          {!versionEditable && <span>Notes as captured in this version, read-only.</span>}
        </div>
      )}
      {values === null ? (
        <p className="t-micro text-muted">Loading notes…</p>
      ) : (
        CARDS.map((c) => (
          <NoteCard
            key={c.field}
            title={c.title}
            audience={c.audience}
            previewable={c.previewable}
            value={values[c.field]}
            editable={editable}
            saved={saves?.[c.field]}
            onSave={(text) => onSave(c.field, text)}
          />
        ))
      )}
    </div>
  );
}
