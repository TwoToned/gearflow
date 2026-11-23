"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { crewTimeEntrySchema, type CrewTimeEntryFormValues } from "@/lib/validations/crew";
import { TimeEntryFields, type AssignmentOption } from "./time-entry-fields";

/**
 * Log time (§9h.4, the live shape): tick everyone who worked the same hours,
 * then ONE set of hours for all of them (one `createManyNative`). A job can be
 * picked only for a single person (it is that person's call); several people
 * log General time with a description, as live.
 */

export interface LogTimePerson {
  id: string;
  name: string;
  /** Role or department, muted beside the name. */
  detail: string;
  assignments: AssignmentOption[];
}

function PickStep({
  people,
  picked,
  setPicked,
  onCancel,
  onNext,
}: {
  people: LogTimePerson[];
  picked: string[];
  setPicked: (ids: string[]) => void;
  onCancel: () => void;
  onNext: () => void;
}) {
  const [q, setQ] = React.useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? people.filter((p) => `${p.name} ${p.detail}`.toLowerCase().includes(needle)) : people;
  const allOn = shown.length > 0 && shown.every((p) => picked.includes(p.id));
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  // Tick all / Clear act on the people SHOWN: with a search active they add to
  // (or take from) the earlier picks, never replace them.
  const shownIds = new Set(shown.map((p) => p.id));
  const tickAll = () => setPicked(allOn ? picked.filter((id) => !shownIds.has(id)) : [...new Set([...picked, ...shownIds])]);
  return (
    <div className="flex flex-col gap-4 p-1">
      <SheetHeader>
        <SheetTitle>Log time</SheetTitle>
        <SheetDescription>Tick everyone who worked the same hours.</SheetDescription>
      </SheetHeader>
      <div className="flex items-center gap-2">
        <Input aria-label="Search people" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="button" variant="ghost" size="sm" onClick={tickAll}>
          {allOn ? "Clear" : "Tick all"}
        </Button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {shown.map((p) => (
          <label key={p.id} className="flex min-h-11 cursor-pointer items-center gap-3 border-t border-line text-ui-text first:border-t-0">
            <Checkbox aria-label={p.name} checked={picked.includes(p.id)} onCheckedChange={() => toggle(p.id)} />
            <span className="min-w-0 flex-1 truncate text-ink">{p.name}</span>
            <span className="text-caption text-muted">{p.detail}</span>
          </label>
        ))}
        {shown.length === 0 && <p className="py-4 text-center text-caption text-muted">No crew members found.</p>}
      </div>
      <SheetFooter>
        <Button type="button" variant="line" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" disabled={picked.length === 0} onClick={onNext}>
          {picked.length > 0 ? `Next · ${picked.length} ticked` : "Next"}
        </Button>
      </SheetFooter>
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

function HoursStep({
  people,
  onBack,
  onSave,
}: {
  people: LogTimePerson[];
  onBack: () => void;
  onSave: (values: CrewTimeEntryFormValues) => Promise<void>;
}) {
  const form = useForm<CrewTimeEntryFormValues>({
    resolver: zodResolver(crewTimeEntrySchema),
    defaultValues: { assignmentId: "", crewMemberId: people[0]?.id ?? "", description: "", date: today(), startTime: "", endTime: "", breakMinutes: "", notes: "" },
  });
  const [saving, setSaving] = React.useState(false);
  const submit = form.handleSubmit(async (values) => {
    setSaving(true);
    await onSave(values);
    setSaving(false);
  });
  const who = people.length === 1 ? people[0].name : `${people.length} people`;
  return (
    <form onSubmit={submit} className="flex flex-col gap-5 p-1">
      <SheetHeader>
        <SheetTitle>Log time</SheetTitle>
        <SheetDescription>{who} · the same hours for everyone ticked</SheetDescription>
      </SheetHeader>
      <TimeEntryFields form={form} assignments={people.length === 1 ? people[0].assignments : []} />
      <SheetFooter>
        <Button type="button" variant="line" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" loading={saving}>
          {people.length > 1 ? `Log time · ${people.length}` : "Log time"}
        </Button>
      </SheetFooter>
    </form>
  );
}

export function LogTimeSheet({
  open,
  onOpenChange,
  people,
  onLog,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  people: LogTimePerson[];
  /** Resolves true when something was logged (the sheet then closes). */
  onLog: (values: CrewTimeEntryFormValues, people: LogTimePerson[]) => Promise<boolean>;
}) {
  const isMobile = useIsMobile();
  const [picked, setPicked] = React.useState<string[]>([]);
  const [step, setStep] = React.useState<"pick" | "hours">("pick");
  const change = (next: boolean) => {
    if (!next) {
      setPicked([]);
      setStep("pick");
    }
    onOpenChange(next);
  };
  const chosen = people.filter((p) => picked.includes(p.id));
  return (
    <Sheet open={open} onOpenChange={change}>
      <SheetContent side={isMobile ? "bottom" : "right"} className="overflow-y-auto sm:max-w-md">
        {step === "pick" ? (
          <PickStep people={people} picked={picked} setPicked={setPicked} onCancel={() => change(false)} onNext={() => setStep("hours")} />
        ) : (
          <HoursStep
            people={chosen}
            onBack={() => setStep("pick")}
            onSave={async (values) => {
              if (await onLog(values, chosen)) change(false);
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
