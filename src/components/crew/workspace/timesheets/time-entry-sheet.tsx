"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { entryDay, jobText, personName, type TimeEntrySource } from "@/lib/list-views/timesheets";
import { crewTimeEntrySchema, type CrewTimeEntryFormValues } from "@/lib/validations/crew";
import { TimeEntryFields, dateInputValue, type AssignmentOption } from "./time-entry-fields";

/** The form values an entry is saved from; also the Undo snapshot for an edit. */
export function entryFormValues(e: TimeEntrySource): CrewTimeEntryFormValues {
  return {
    assignmentId: e.assignmentId ?? "",
    crewMemberId: e.crewMemberId,
    description: e.description ?? "",
    date: dateInputValue(e.date),
    startTime: e.startTime,
    endTime: e.endTime,
    breakMinutes: e.breakMinutes ? String(e.breakMinutes) : "",
    notes: e.notes ?? "",
  };
}

function EditForm({
  entry,
  assignments,
  onCancel,
  onSave,
}: {
  entry: TimeEntrySource;
  assignments: AssignmentOption[];
  onCancel: () => void;
  onSave: (next: CrewTimeEntryFormValues, snapshot: CrewTimeEntryFormValues) => Promise<boolean>;
}) {
  const snapshot = React.useMemo(() => entryFormValues(entry), [entry]);
  // The entry's own call stays pickable even when the roster no longer lists it (e.g. cancelled since).
  const options = React.useMemo(
    () => (entry.assignmentId && !assignments.some((a) => a.id === entry.assignmentId) ? [{ id: entry.assignmentId, label: jobText(entry) }, ...assignments] : assignments),
    [entry, assignments],
  );
  const form = useForm<CrewTimeEntryFormValues>({ resolver: zodResolver(crewTimeEntrySchema), defaultValues: snapshot });
  const [saving, setSaving] = React.useState(false);
  const submit = form.handleSubmit(async (values) => {
    setSaving(true);
    const ok = await onSave(values, snapshot);
    setSaving(false);
    if (ok) onCancel();
  });
  return (
    <form onSubmit={submit} className="flex flex-col gap-5 p-1">
      <SheetHeader>
        <SheetTitle>Edit time entry</SheetTitle>
        <SheetDescription>
          {personName(entry)} · {entryDay(entry.date)}
        </SheetDescription>
      </SheetHeader>
      {entry.queryReason && (
        <p className="text-caption text-warn">
          Queried: {entry.queryReason}
        </p>
      )}
      <TimeEntryFields form={form} assignments={options} />
      <SheetFooter>
        <Button type="button" variant="line" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          Save
        </Button>
      </SheetFooter>
    </form>
  );
}

/**
 * Edit entry (§9h.4): a sheet over the list (right on desktop, bottom on a
 * phone). Saving is ONE `update`; its Undo replays the snapshot taken here.
 */
export function TimeEntrySheet({
  entry,
  assignments,
  onOpenChange,
  onSave,
}: {
  entry: TimeEntrySource | null;
  assignments: AssignmentOption[];
  onOpenChange: (open: boolean) => void;
  onSave: (next: CrewTimeEntryFormValues, snapshot: CrewTimeEntryFormValues) => Promise<boolean>;
}) {
  const isMobile = useIsMobile();
  return (
    <Sheet open={!!entry} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? "bottom" : "right"} className="overflow-y-auto sm:max-w-md">
        {entry && <EditForm key={entry.id} entry={entry} assignments={assignments} onCancel={() => onOpenChange(false)} onSave={onSave} />}
      </SheetContent>
    </Sheet>
  );
}
