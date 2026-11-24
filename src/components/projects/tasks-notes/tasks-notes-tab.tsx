"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { TasksPanel } from "@/components/projects/tasks-panel";
import { VersionNotTrackedNote } from "@/components/projects/version-not-tracked-note";
import type { TasksNotesSection } from "@/lib/job-tabs";

/**
 * The job's one `Tasks & notes` tab (UX Phase 10, spec §8c). The Tasks, Notes and
 * Files tabs merged here; `?tab=tasks|notes|files` all land on it, and `notes` /
 * `files` scroll to their section.
 *
 * Slice A: the three existing bodies stacked under section headings, so no live
 * feature is out of reach while the tab key is merged. Slices C and D replace each
 * slot with its section component (task rows, notes cards, files, discussion).
 */
function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 pb-2 pt-6 text-overline uppercase tracking-wide text-muted first:pt-0">
      {children}
    </h2>
  );
}

export function TasksNotesTab({
  projectId,
  section,
  notes,
  files,
}: {
  projectId: string;
  section: TasksNotesSection | null;
  notes: ReactNode;
  files: ReactNode;
}) {
  const filesRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = section === "notes" ? notesRef.current : section === "files" ? filesRef.current : null;
    target?.scrollIntoView?.({ block: "start" });
  }, [section]);

  return (
    <div>
      <SectionHeading id="tn-tasks">Tasks</SectionHeading>
      <VersionNotTrackedNote what="Tasks" />
      <TasksPanel projectId={projectId} />
      <div ref={notesRef}>
        <SectionHeading id="tn-notes">Notes</SectionHeading>
        {notes}
      </div>
      <div ref={filesRef}>
        <SectionHeading id="tn-files">Files</SectionHeading>
        <VersionNotTrackedNote what="Files" />
        {files}
      </div>
    </div>
  );
}
