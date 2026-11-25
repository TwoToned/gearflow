"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { DiscussionSection } from "@/components/projects/tasks-notes/discussion-section";
import { FilesSection } from "@/components/projects/tasks-notes/files-section";
import { NotesSection, type NoteValues } from "@/components/projects/tasks-notes/notes-section";
import { TasksSection } from "@/components/projects/tasks-notes/tasks-section";
import { VersionNotTrackedNote } from "@/components/projects/version-not-tracked-note";
import type { JobTabKey, TasksNotesSection } from "@/lib/job-tabs";
import { cn, focusRing } from "@/lib/utils";

/**
 * The job's one `Tasks & notes` tab (UX Phase 10, spec §8c). Tasks, Notes and Files
 * merged here; `?tab=tasks|notes|files|discussion` all land on it and scroll to their
 * section. Desktop is two columns (tasks then files; notes then discussion) that
 * collapse to ONE below `xl` (the context sidebar keeps its width); a phone gets a
 * sticky `Tasks · Notes · Files · Discussion` chip row that jumps to each.
 */
const SECTIONS: { key: TasksNotesSection; label: string }[] = [
  { key: "tasks", label: "Tasks" },
  { key: "notes", label: "Notes" },
  { key: "files", label: "Files" },
  { key: "discussion", label: "Discussion" },
];

function Heading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-28 pb-2 pt-6 text-overline uppercase tracking-wide text-muted first:pt-0">
      {children}
    </h2>
  );
}

/** The phone's sticky jump row. */
function SectionChips({ onJump }: { onJump: (key: TasksNotesSection) => void }) {
  return (
    <nav aria-label="Jump to a section" className="sticky top-0 z-10 -mx-4 flex gap-4 overflow-x-auto border-b border-line bg-paper px-4 md:hidden">
      {SECTIONS.map((s) => (
        <button key={s.key} type="button" onClick={() => onJump(s.key)} className={cn("min-h-11 shrink-0 rounded-sm text-ui-text text-ink-2 hover:text-ink", focusRing)}>
          {s.label}
        </button>
      ))}
    </nav>
  );
}

export function TasksNotesTab({
  projectId,
  orgId,
  section,
  composedNotes,
  onSaveNote,
  onOpenTab,
}: {
  projectId: string;
  orgId: string | undefined;
  section: TasksNotesSection | null;
  /** The notes the page shows (a viewed version's when one is open). */
  composedNotes: NoteValues;
  onSaveNote: (field: "crewNotes" | "internalNotes" | "clientNotes", text: string) => Promise<unknown>;
  onOpenTab: (tab: JobTabKey) => void;
}) {
  const refs = useRef<Partial<Record<TasksNotesSection, HTMLElement | null>>>({});
  const jump = (key: TasksNotesSection) => refs.current[key]?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  useEffect(() => {
    if (section) refs.current[section]?.scrollIntoView?.({ block: "start" });
  }, [section]);
  const slot = (key: TasksNotesSection) => (el: HTMLElement | null) => {
    refs.current[key] = el;
  };

  return (
    <div>
      <SectionChips onJump={jump} />
      <div className="grid gap-x-10 xl:grid-cols-2">
        <div className="min-w-0">
          <section ref={slot("tasks")}>
            <Heading id="tn-tasks">Tasks</Heading>
            <VersionNotTrackedNote what="Tasks" />
            {/* Keyed by org: switching organisation must drop the selection and any open sheet. */}
            <TasksSection key={orgId} projectId={projectId} />
          </section>
          <section ref={slot("files")}>
            <Heading id="tn-files">Files</Heading>
            <VersionNotTrackedNote what="Files" />
            <FilesSection projectId={projectId} orgId={orgId} />
          </section>
        </div>
        <div className="min-w-0">
          <section ref={slot("notes")}>
            <Heading id="tn-notes">Notes</Heading>
            <NotesSection projectId={projectId} orgId={orgId} composed={composedNotes} onSave={onSaveNote} />
          </section>
          <section ref={slot("discussion")}>
            <Heading id="tn-discussion">Discussion</Heading>
            <DiscussionSection projectId={projectId} orgId={orgId} onOpenEquipment={() => onOpenTab("equipment")} />
          </section>
        </div>
      </div>
    </div>
  );
}
