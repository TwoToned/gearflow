"use client";

import * as React from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StatusWord } from "@/components/ui/status-word";
import { Switch } from "@/components/ui/switch";
import type { CrewRoleDoc } from "@/hooks/use-crew";
import { useIsMobile } from "@/hooks/use-mobile";
import { byLastName, shortOn, dayState, displayDate, DAY_KIND_INTENT, isMultiDay, keyOfMs, memberName, type OpenCall, type PlannerMember } from "@/lib/crew-planner";
import { factText } from "@/lib/primitives/facts";
import { formatWeekdayDayMonth } from "@/lib/formatters";
import { crewRateTypeLabels } from "@/lib/status-labels";
import { cn } from "@/lib/utils";
import { plannerOfferSchema, type PlannerOfferValues } from "@/lib/validations/crew";

/**
 * Offer a call (spec §9h.3): for a person and a day, one of the open job
 * services that day (`needs n`), with the role and times from the service.
 * Changing the person or the day re-checks their day; a clash is shown and
 * the offer is still allowed (marks are advisory). `Send the offer now` (on
 * by default) emails at once — so the button asks once more first, and the
 * toast has no Undo; off, the call waits as Pending and its Undo removes it.
 * The cost rate prints only when the server sent the role's rate (pay is
 * decided server-side, never from the viewer's role here).
 */
export interface OfferTarget {
  memberId?: string;
  day: string;
  serviceId?: string;
}

interface Ctx {
  members: PlannerMember[];
  open: OpenCall[];
  roles: CrewRoleDoc[];
  days: string[];
  week: string;
}

type Form = UseFormReturn<PlannerOfferValues>;

/** Every open service short of people on `day` — a multi-day run is listed on each day it is short. */
const servicesOn = (c: Ctx, day: string) => c.open.filter((o) => shortOn(o, day) > 0);

/** The service a new offer defaults to: one with the person's role, else the first open one. */
function defaultService(c: Ctx, memberId: string, day: string): OpenCall | undefined {
  const role = c.members.find((m) => m.id === memberId)?.crewRole?.id;
  const list = servicesOn(c, day);
  return list.find((o) => role && o.crewRoleId === role) ?? list[0];
}

type ServiceFields = Pick<PlannerOfferValues, "serviceId" | "crewRoleId" | "startTime" | "endTime">;

/** The role and times an offer takes from its service (the person's own role when the service names none). */
function fromService(o: OpenCall | undefined, member: PlannerMember | undefined): ServiceFields {
  const role = member?.crewRole?.id ?? "";
  if (!o) return { serviceId: "", crewRoleId: role, startTime: "", endTime: "" };
  return { serviceId: o.serviceId, crewRoleId: o.crewRoleId || role, startTime: o.startTime || "", endTime: o.endTime || "" };
}

function initialValues(t: OfferTarget, c: Ctx): PlannerOfferValues {
  const memberId = t.memberId ?? "";
  const member = c.members.find((m) => m.id === memberId);
  const svc = (t.serviceId && c.open.find((o) => o.serviceId === t.serviceId)) || defaultService(c, memberId, t.day);
  return { memberId, day: t.day, sendNow: true, span: "day", ...fromService(svc, member) };
}

const dayLabel = (d: string) => formatWeekdayDayMonth(displayDate(d));

function PickSelect({ id, label, value, display, onChange, options, placeholder }: {
  id: string; label: string; value: string; display: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder: string;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger id={id} aria-label={label}>
          <SelectValue placeholder={placeholder}>{value ? display : placeholder}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function personOption(m: PlannerMember, day: string) {
  const s = dayState(m, day);
  const note = s.kind === "free" || s.kind === "preferred" ? "" : ` · ${s.kind}`;
  return { value: m.id, label: `${memberName(m)}${m.crewRole ? ` · ${m.crewRole.name}` : ""}${note}` };
}

function DayLine({ member, day }: { member: PlannerMember | undefined; day: string }) {
  if (!member) return <p className="text-caption text-muted">Choose a person to check their day.</p>;
  const s = dayState(member, day);
  const clash = s.kind === "unavailable" || s.kind === "booked";
  return (
    <p className="text-caption" data-testid="offer-day-state">
      <StatusWord status={{ label: s.text, intent: DAY_KIND_INTENT[s.kind] }} className="text-caption" />
      {clash && <span className="text-muted"> · you can still offer; they will see the clash</span>}
    </p>
  );
}

function RateLine({ role }: { role: CrewRoleDoc | undefined }) {
  if (!role || role.defaultRate == null) return null;
  const unit = role.rateType ? ` · ${crewRateTypeLabels[role.rateType] ?? role.rateType}` : "";
  return (
    <p className="text-caption text-muted">
      Cost rate {factText({ kind: "money", amount: role.defaultRate })}
      {unit} · from the role
    </p>
  );
}

function ServiceField({ form, c, onPick }: { form: Form; c: Ctx; onPick: (id: string) => void }) {
  const day = form.watch("day");
  const list = servicesOn(c, day);
  const value = form.watch("serviceId");
  if (list.length === 0) {
    return (
      <div className="space-y-1">
        <Label>Job service</Label>
        <p className="text-caption text-muted">No call is short of people this day. Add a service on the job&apos;s Logistics tab first.</p>
      </div>
    );
  }
  const label = (o: OpenCall) => `${o.projectNumber} ${o.title}${o.crewRoleName ? ` · ${o.crewRoleName}` : ""} · needs ${shortOn(o, day)}`;
  const picked = list.find((o) => o.serviceId === value);
  return (
    <PickSelect id="offer-service" label="Job service" value={value} display={picked ? label(picked) : ""} onChange={onPick}
      options={list.map((o) => ({ value: o.serviceId, label: label(o) }))} placeholder="Pick a service" />
  );
}

/** A multi-day service asks what the call covers: the picked day, or the whole run. */
function SpanField({ open, value, day, onChange }: { open: OpenCall | undefined; value: PlannerOfferValues["span"]; day: string; onChange: (v: PlannerOfferValues["span"]) => void }) {
  if (!open || !isMultiDay(open)) return null;
  const run = `${dayLabel(keyOfMs(open.date!))} – ${dayLabel(keyOfMs(open.endDate!))}`;
  const choices: { v: PlannerOfferValues["span"]; label: string }[] = [
    { v: "day", label: `This day only · ${dayLabel(day)}` },
    { v: "run", label: `Whole run · ${run}` },
  ];
  return (
    <div role="radiogroup" aria-label="Call covers" className="flex flex-col gap-1">
      <span className="text-ui-text font-medium text-ink">This service runs {run}</span>
      {choices.map((ch) => (
        <button
          key={ch.v}
          type="button"
          role="radio"
          aria-checked={value === ch.v}
          onClick={() => onChange(ch.v)}
          className="flex min-h-11 items-center gap-3 text-left text-ui-text text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red"
        >
          <span aria-hidden="true" className={cn("grid size-4 place-items-center rounded-full border-2", value === ch.v ? "border-primary" : "border-input")}>
            {value === ch.v && <span className="size-2 rounded-full bg-primary" />}
          </span>
          {ch.label}
        </button>
      ))}
    </div>
  );
}

function Fields({ form, c }: { form: Form; c: Ctx }) {
  const v = form.watch();
  const member = c.members.find((m) => m.id === v.memberId);
  const activeRoles = c.roles.filter((r) => r.isActive !== false || r.id === v.crewRoleId);
  const set = (patch: Partial<PlannerOfferValues>) => {
    for (const [k, val] of Object.entries(patch)) form.setValue(k as keyof PlannerOfferValues, val as never, { shouldValidate: false });
  };
  const pickPerson = (id: string) => set({ memberId: id, ...fromService(defaultService(c, id, v.day), c.members.find((m) => m.id === id)) });
  const pickDay = (day: string) => set({ day, ...fromService(defaultService(c, v.memberId, day), member) });
  const pickService = (id: string) => set(fromService(c.open.find((o) => o.serviceId === id), member));
  const people = [...c.members].sort(byLastName).map((m) => personOption(m, v.day));
  const err = form.formState.errors;
  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1">
        <PickSelect id="offer-person" label="Person" value={v.memberId} display={member ? memberName(member) : ""} onChange={pickPerson} options={people} placeholder="Choose a person…" />
        <DayLine member={member} day={v.day} />
        {err.memberId && <p className="text-caption text-t-out">{err.memberId.message}</p>}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <PickSelect id="offer-day" label="Day" value={v.day} display={dayLabel(v.day)} onChange={pickDay} options={c.days.map((d) => ({ value: d, label: dayLabel(d) }))} placeholder="Day" />
        {/* The service label is long (`#2341 Show day · LX op · needs 1`): its own full row. */}
        <div className="md:col-span-2">
          <ServiceField form={form} c={c} onPick={pickService} />
          <SpanField open={c.open.find((o) => o.serviceId === v.serviceId)} value={v.span} day={v.day} onChange={(span) => set({ span })} />
        </div>
      </div>
      {err.serviceId && <p className="text-caption text-t-out">{err.serviceId.message}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <PickSelect id="offer-role" label="Role" value={v.crewRoleId} display={activeRoles.find((r) => r.id === v.crewRoleId)?.name ?? ""} onChange={(id) => set({ crewRoleId: id })}
            options={activeRoles.map((r) => ({ value: r.id, label: r.name }))} placeholder="Role" />
          <RateLine role={c.roles.find((r) => r.id === v.crewRoleId)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="offer-start">Start</Label>
          <Input id="offer-start" type="time" {...form.register("startTime")} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="offer-end">End</Label>
          <Input id="offer-end" type="time" {...form.register("endTime")} />
        </div>
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-ui-text text-ink">
        <Switch aria-label="Send the offer now" checked={v.sendNow} onCheckedChange={(on) => set({ sendNow: on })} />
        Send the offer now · otherwise it waits as Pending
      </label>
    </div>
  );
}

function OfferForm({ target, c, onCancel, onSubmit }: { target: OfferTarget; c: Ctx; onCancel: () => void; onSubmit: (v: PlannerOfferValues) => Promise<boolean> }) {
  const form = useForm<PlannerOfferValues>({ resolver: zodResolver(plannerOfferSchema), defaultValues: initialValues(target, c) });
  const [confirming, setConfirming] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const sendNow = form.watch("sendNow");
  const member = c.members.find((m) => m.id === form.watch("memberId"));
  const save = form.handleSubmit(async (values) => {
    // An offer emails at once and can't be unsent: ask once more, in place.
    if (values.sendNow && !confirming) return setConfirming(true);
    setSaving(true);
    const ok = await onSubmit(values);
    setSaving(false);
    if (ok) onCancel();
  });
  return (
    <form onSubmit={save} className="flex flex-col gap-5 p-1">
      <SheetHeader>
        <SheetTitle>Offer a call</SheetTitle>
        <SheetDescription>{member ? `${memberName(member)} · ${dayLabel(form.watch("day"))}` : "This week"}</SheetDescription>
      </SheetHeader>
      <Fields form={form} c={c} />
      {confirming && (
        <p className="text-ui-text text-ink" role="alert">
          This emails {member ? memberName(member) : "them"} an offer with Accept and Decline now. It can&apos;t be unsent.
        </p>
      )}
      <SheetFooter>
        <Button type="button" variant="line" onClick={confirming ? () => setConfirming(false) : onCancel}>
          {confirming ? "Back" : "Cancel"}
        </Button>
        <Button type="submit" loading={saving}>
          {!sendNow ? "Save as pending" : confirming ? "Send offer" : "Offer call"}
        </Button>
      </SheetFooter>
    </form>
  );
}

export function OfferCallSheet({ target, onOpenChange, onSubmit, ...c }: Ctx & {
  target: OfferTarget | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (v: PlannerOfferValues) => Promise<boolean>;
}) {
  const isMobile = useIsMobile();
  const key = target ? `${target.memberId ?? ""}:${target.day}:${target.serviceId ?? ""}` : "none";
  return (
    <Sheet open={!!target} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? "bottom" : "right"} className="overflow-y-auto sm:max-w-md">
        {target && <OfferForm key={key} target={target} c={c} onCancel={() => onOpenChange(false)} onSubmit={onSubmit} />}
      </SheetContent>
    </Sheet>
  );
}
