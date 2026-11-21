"use client";

import type { UseFormReturn } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CrewTimeEntryFormValues } from "@/lib/validations/crew";

/**
 * The fields an entry is made of (Edit entry and Log time share them, R-3.1):
 * Job (a call, or General with a description), Date, Start, End, Break, Notes.
 * Inputs are the app's 16px / 44px controls, so a phone never zooms.
 */

export interface AssignmentOption {
  id: string;
  label: string;
}

/** `#2336 Hilton gala (Rigger)`; `GENERAL` = no job, a description instead. */
export const GENERAL = "__general__";

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-caption text-t-out">{message}</p> : null;
}

function JobField({
  form,
  assignments,
  fixedJob,
}: {
  form: UseFormReturn<CrewTimeEntryFormValues>;
  /** The calls this entry can sit on; empty when more than one person is ticked. */
  assignments: AssignmentOption[];
  /** Edit entry: the job is fixed by the call, printed read-only. */
  fixedJob?: string;
}) {
  const value = form.watch("assignmentId") || GENERAL;
  if (fixedJob) {
    return (
      <div className="space-y-1">
        <Label>Job</Label>
        <p className="text-ui-text text-ink">{fixedJob}</p>
      </div>
    );
  }
  const label = value === GENERAL ? "General · no job" : assignments.find((a) => a.id === value)?.label ?? "General · no job";
  return (
    <div className="space-y-1">
      <Label htmlFor="te-job">Job</Label>
      <Select value={value} onValueChange={(v) => form.setValue("assignmentId", v === GENERAL ? "" : v)}>
        <SelectTrigger id="te-job" aria-label="Job">
          <SelectValue>{label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={GENERAL}>General · no job</SelectItem>
          {assignments.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function TimeEntryFields({
  form,
  assignments,
  fixedJob,
}: {
  form: UseFormReturn<CrewTimeEntryFormValues>;
  assignments: AssignmentOption[];
  fixedJob?: string;
}) {
  const errors = form.formState.errors;
  const general = !form.watch("assignmentId") && !fixedJob;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <JobField form={form} assignments={assignments} fixedJob={fixedJob} />
        <div className="space-y-1">
          <Label htmlFor="te-date">Date</Label>
          <Input id="te-date" type="date" {...form.register("date")} aria-invalid={!!errors.date} />
          <FieldError message={errors.date?.message} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="te-start">Start</Label>
          <Input id="te-start" type="time" {...form.register("startTime")} aria-invalid={!!errors.startTime} />
          <FieldError message={errors.startTime?.message} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="te-end">End</Label>
          <Input id="te-end" type="time" {...form.register("endTime")} aria-invalid={!!errors.endTime} />
          <FieldError message={errors.endTime?.message} />
        </div>
        <div className="col-span-2 space-y-1 md:col-span-1">
          <Label htmlFor="te-break">Break (min)</Label>
          <Input id="te-break" type="number" inputMode="numeric" min={0} placeholder="0" className="font-mono" {...form.register("breakMinutes")} />
        </div>
      </div>
      {general && (
        <div className="space-y-1">
          <Label htmlFor="te-desc">Description</Label>
          <Input id="te-desc" placeholder="What they did, e.g. Warehouse maintenance" {...form.register("description")} />
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="te-notes">Notes</Label>
        <Textarea id="te-notes" placeholder="Optional" {...form.register("notes")} />
      </div>
    </div>
  );
}

/** A `YYYY-MM-DD` value for a date input from a stored ISO date (UTC midnight). */
export function dateInputValue(iso: string): string {
  return iso.slice(0, 10);
}
