"use client";

import { useEffect, useRef, useState } from "react";
import type { Path, UseFormReturn } from "react-hook-form";
import { Controller } from "react-hook-form";
import { format } from "date-fns";
import { X, Truck } from "lucide-react";
import { cn, focusRing } from "@/lib/utils";
import {
  RangeCalendar, DURATION_PRESETS, presetRange, rangeLengthLabel, type DateRange,
} from "@/components/ui/range-calendar";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { useServerQuery } from "@/hooks/use-server-query";
import type { ProjectFormValues } from "@/lib/validations/project";
import { peekNextProjectNumber } from "@/server/projects";
import { useClientSearch, useClient, useClientContacts } from "@/hooks/use-clients";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useLocations } from "@/hooks/use-locations";
import { useOrgTags } from "@/hooks/use-org-tags";
import { getOrgMembers } from "@/server/org-members";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LockedField } from "@/components/ui/locked-field";
import { Textarea } from "@/components/ui/textarea";
import { useProjectPricingLock } from "@/hooks/use-project-lock";
import { resolveLockCopy, scrollToLockStrip } from "@/lib/lock-copy";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { TagInput } from "@/components/ui/tag-input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { QuickCreateClient } from "@/components/clients/quick-create-client";
import { QuickCreateLocation } from "@/components/assets/quick-create-location";
import { PROJECT_TYPE_OPTIONS } from "@/lib/project-type-labels";
import { fromDateStr, normalizeDate, shiftWindowWithRental, toDateStr } from "@/lib/project-form-dates";

/**
 * `ProjectFields` — THE job field list (UX Phase 9, spec 7c.6), in
 * `projectSchema`'s order, rendered by the wizard's steps now and by the edit
 * sheet next. `status` is deliberately not a field: it moves only through the
 * header stepper, which runs the accepted-quote, blocking-discussion and
 * confirm-impact checks the old Select skipped.
 *
 * Sections let a caller place the same fields: the wizard shows `job`+`money`,
 * then `schedule`, then `where` as its steps; the sheet shows all four.
 */

/**
 * The project detail shape the form needs when editing. Loosely typed (all
 * optional, dates as `unknown`) so the page can pass its `useProjectDetail`
 * composite straight through — `projectFormDefaults` normalises everything to the
 * form's `yyyy-MM-dd` / `HH:mm` string shape.
 */
export interface EditableProject {
  id: string;
  projectNumber?: string | null;
  name?: string | null;
  clientId?: string | null;
  clientContactId?: string | null;
  status?: ProjectFormValues["status"] | null;
  type?: ProjectFormValues["type"] | null;
  description?: string | null;
  locationId?: string | null;
  siteContactName?: string | null;
  siteContactPhone?: string | null;
  siteContactEmail?: string | null;
  loadInDate?: unknown;
  loadInTime?: string | null;
  eventStartDate?: unknown;
  eventStartTime?: string | null;
  eventEndDate?: unknown;
  eventEndTime?: string | null;
  loadOutDate?: unknown;
  loadOutTime?: string | null;
  /** WS2 (#941) — the gear-committed window; blank means "same as rental". */
  projectStartDate?: unknown;
  projectStartTime?: string | null;
  projectEndDate?: unknown;
  projectEndTime?: string | null;
  rentalStartDate?: unknown;
  rentalEndDate?: unknown;
  crewNotes?: string | null;
  internalNotes?: string | null;
  clientNotes?: string | null;
  discountPercent?: number | string | null;
  tags?: string[] | null;
  isTemplate?: boolean;
  projectManagers?: { user: { id: string } }[];
}

/** The form's starting values: a stored project, or blank. */
export function projectFormDefaults(project?: EditableProject): ProjectFormValues {
  if (!project) {
    return {
      projectNumber: "", name: "", clientId: "", clientContactId: "", status: "ENQUIRY", type: "OTHER",
      description: "", locationId: "", siteContactName: "", siteContactPhone: "", siteContactEmail: "",
      loadInDate: undefined, loadInTime: "", eventStartDate: undefined, eventStartTime: "",
      eventEndDate: undefined, eventEndTime: "", loadOutDate: undefined, loadOutTime: "",
      projectStartDate: undefined, projectStartTime: "", projectEndDate: undefined, projectEndTime: "",
      rentalStartDate: undefined, rentalEndDate: undefined,
      crewNotes: "", internalNotes: "", clientNotes: "", tags: [],
    };
  }
  return storedProjectDefaults(project);
}

const text = (v?: string | null) => v ?? "";

function storedProjectDefaults(p: EditableProject): ProjectFormValues {
  return {
    projectNumber: text(p.projectNumber), name: text(p.name), clientId: text(p.clientId),
    clientContactId: text(p.clientContactId),
    status: p.status ?? "ENQUIRY", type: p.type ?? "OTHER",
    description: text(p.description), locationId: text(p.locationId),
    siteContactName: text(p.siteContactName), siteContactPhone: text(p.siteContactPhone),
    siteContactEmail: text(p.siteContactEmail),
    // loadIn/loadOut/eventStart/eventEnd are DEPRECATED — read for a pre-WS2
    // project (so an old value isn't silently dropped) but never written by the UI;
    // project*/rental* are the two windows now.
    loadInDate: normalizeDate(p.loadInDate), loadInTime: text(p.loadInTime),
    eventStartDate: normalizeDate(p.eventStartDate), eventStartTime: text(p.eventStartTime),
    eventEndDate: normalizeDate(p.eventEndDate), eventEndTime: text(p.eventEndTime),
    loadOutDate: normalizeDate(p.loadOutDate), loadOutTime: text(p.loadOutTime),
    projectStartDate: normalizeDate(p.projectStartDate), projectStartTime: text(p.projectStartTime),
    projectEndDate: normalizeDate(p.projectEndDate), projectEndTime: text(p.projectEndTime),
    rentalStartDate: normalizeDate(p.rentalStartDate), rentalEndDate: normalizeDate(p.rentalEndDate),
    crewNotes: text(p.crewNotes), internalNotes: text(p.internalNotes), clientNotes: text(p.clientNotes),
    discountPercent: p.discountPercent != null ? Number(p.discountPercent) : undefined,
    tags: p.tags ?? [],
  };
}

const managerIdsOf = (p?: EditableProject) => (p?.projectManagers ?? []).map((pm) => pm.user.id);

export type ProjectFieldsSection = "job" | "schedule" | "where" | "money";

/** Everything the fields read (pickers' data, the discount lock, the manager set). */
export function useProjectFieldsState({
  form, project, orgId, isTemplate, prefillCode,
}: {
  form: UseFormReturn<ProjectFormValues>;
  project?: EditableProject;
  orgId: string | undefined;
  isTemplate: boolean;
  /** The wizard turns this off: its draft allocates the number in the create
   *  mutation (counter reserved atomically), so the field must stay blank until then. */
  prefillCode?: boolean;
}) {
  const isEditing = !!project;
  const initialManagerIds = managerIdsOf(project);
  const [managerIds, setManagerIds] = useState<string[]>(initialManagerIds);

  // #1230 — `discountPercent` is a LOCKED_PROJECT_FIELDS entry. Skipped on create.
  const lockStatus = useProjectPricingLock(isEditing ? project.id : undefined, orgId);
  const discountLocked = isEditing && lockStatus.pricingLocked;
  const discountLockReason = resolveLockCopy(lockStatus).oneLiner;

  const { data: nextProjectNumber } = useServerQuery({
    queryKey: ["project-number-next", orgId],
    queryFn: () => peekNextProjectNumber(),
    enabled: !isTemplate && !isEditing && !!orgId,
  });

  const { setClientQuery, clients, clientOptions, locationOptions, orgTags, memberOptions, membersError } = usePickerData(orgId);

  const clientId = form.watch("clientId");
  // Resolve the selected client directly (it may not be in the current search page) —
  // used for the display label AND the discount-default prefill.
  const selectedClient = useClient(clientId || undefined);
  const discountTouchedRef = useDiscountPrefill(form, clientId, selectedClient, project?.clientId);
  const { clientContacts, contactOptions } = useClientContactState(form, clientId, orgId, project?.clientId);
  useProjectCodePrefill(form, nextProjectNumber, prefillCode);

  return {
    isEditing, isTemplate, initialManagerIds, managerIds, setManagerIds,
    discountLocked, discountLockReason, markDiscountTouched: () => { discountTouchedRef.current = true; },
    nextProjectNumber, setClientQuery, clients, clientOptions, locationOptions, orgTags,
    memberOptions, membersError, selectedClient, selectedClientName: selectedClient?.name,
    clientContacts, contactOptions,
  };
}

type FormApi = UseFormReturn<ProjectFormValues>;

/** The pickers' option lists: clients (bounded indexed search), locations, tags, org members. */
function usePickerData(orgId: string | undefined) {
  const [clientQuery, setClientQuery] = useState("");
  const debouncedClientQuery = useDebouncedValue(clientQuery, 200);
  const clients = useClientSearch(orgId, debouncedClientQuery);
  const clientOptions = (clients ?? []).map((c) => ({ value: c.id, label: c.name, description: c.contactName || undefined }));
  const rawLocations = useLocations(orgId) ?? [];
  const locNameById = new Map(rawLocations.map((l) => [l.id, l.name]));
  const locationOptions = rawLocations.map((l) => ({ value: l.id, label: l.parentId ? `${locNameById.get(l.parentId) ?? ""} → ${l.name}` : l.name, description: l.address || undefined }));
  const orgTags = useOrgTags(orgId);
  const { data: membersData, error: membersError } = useServerQuery({ queryKey: ["org-members", orgId], queryFn: () => getOrgMembers({ pageSize: 200 }) });
  const memberOptions = (membersData?.members || []).map((m) => ({ value: m.user.id, label: m.user.name || m.user.email, description: m.user.name ? m.user.email : undefined }));
  return { setClientQuery, clients, clientOptions, locationOptions, orgTags, memberOptions, membersError };
}

/**
 * QW-4 (#953): prefill Discount from the selected client's `defaultDiscount` — a
 * UX convenience only; the server-authoritative snapshot happens in
 * `projectWrites.createNative` (R-9.3). Re-prefills each time the client changes,
 * but ONLY while the user hasn't touched the field (an explicit 0 counts as
 * touched). Never fires on the initial load of an existing project. Returns the
 * "touched" ref the Discount input sets.
 */
function useDiscountPrefill(
  form: FormApi,
  clientId: string | undefined,
  selectedClient: { id: string; defaultDiscount?: number | null } | null | undefined,
  initialClientId: string | null | undefined,
) {
  const touchedRef = useRef(false);
  const prefilledFor = useRef(initialClientId ?? "");
  useEffect(() => {
    const current = clientId || "";
    if (!current || touchedRef.current || prefilledFor.current === current) return;
    if (selectedClient?.id !== current) return; // still loading / stale
    prefilledFor.current = current;
    form.setValue(
      "discountPercent",
      selectedClient.defaultDiscount != null ? Number(selectedClient.defaultDiscount) : undefined,
      { shouldDirty: false },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, selectedClient]);
  return touchedRef;
}

/**
 * Per-project contact picker (WS9 #948). A contact belongs to ONE client, so
 * changing the client clears it (the server enforces this too; this is UX).
 */
function useClientContactState(form: FormApi, clientId: string | undefined, orgId: string | undefined, initialClientId: string | null | undefined) {
  const clientContacts = useClientContacts(clientId || undefined, orgId);
  const contactOptions = (clientContacts ?? []).map((c) => ({
    value: c.id,
    label: c.name || c.email || c.phone || "Unnamed contact",
    description: c.isPrimary ? "Primary" : undefined,
  }));
  const prevClientIdRef = useRef(initialClientId ?? "");
  useEffect(() => {
    const current = clientId || "";
    if (current !== prevClientIdRef.current) {
      prevClientIdRef.current = current;
      form.setValue("clientContactId", "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);
  return { clientContacts, contactOptions };
}

/** Pre-fill the project code from the org's next sequence so the (required)
 *  field is populated by default — the user accepts it or types their own. */
function useProjectCodePrefill(form: FormApi, nextProjectNumber: string | null | undefined, enabled?: boolean) {
  useEffect(() => {
    if (enabled !== false && nextProjectNumber && !form.getValues("projectNumber")) {
      form.setValue("projectNumber", nextProjectNumber);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextProjectNumber]);
}

type ProjectFieldsState = ReturnType<typeof useProjectFieldsState>;

export function ProjectFields({
  form, state, sections, schedule,
}: {
  form: UseFormReturn<ProjectFormValues>;
  state: ProjectFieldsState;
  sections: ProjectFieldsSection[];
  /** The wizard's availability extras under the rental calendar. */
  schedule?: { busyDays?: ReadonlyMap<string, string>; footer?: React.ReactNode };
}) {
  const has = (s: ProjectFieldsSection) => sections.includes(s);
  return (
    <>
      {has("job") && <JobFields form={form} state={state} />}
      {has("money") && <MoneyFields form={form} state={state} />}
      {has("schedule") && <ScheduleFields form={form} busyDays={schedule?.busyDays} footer={schedule?.footer} />}
      {has("where") && <WhereFields form={form} state={state} />}
    </>
  );
}

function JobFields({ form, state }: { form: UseFormReturn<ProjectFormValues>; state: ProjectFieldsState }) {
  const [quickClient, setQuickClient] = useState(false);
  const clientId = form.watch("clientId");
  const typeValue = form.watch("type");
  const typeName = PROJECT_TYPE_OPTIONS.find((t) => t.value === typeValue)?.label;
  const { managerIds, setManagerIds, memberOptions } = state;
  return (
    <div className="space-y-5">
      <div data-tour-anchor="tour-project-name">
        <Field label="Name" required error={form.formState.errors.name?.message}>
          <Input {...form.register("name")} placeholder="e.g. Summer Festival 2026" autoFocus />
        </Field>
      </div>
      {!state.isTemplate && (
        <Field label="Job code" required hint="Pre-filled from your next sequence — edit if you need a custom code." error={form.formState.errors.projectNumber?.message}>
          <Input {...form.register("projectNumber")} placeholder={state.nextProjectNumber ? `Auto: ${state.nextProjectNumber}` : "e.g. PROJ-2026-0001"} className="font-mono" />
        </Field>
      )}
      <Field label="Client">
        <Controller control={form.control} name="clientId" render={({ field }) => (
          <ComboboxPicker value={field.value || ""} onChange={field.onChange} options={state.clientOptions}
            onSearchChange={state.setClientQuery} loading={state.clients === undefined} selectedLabel={state.selectedClientName}
            placeholder="Select client…" searchPlaceholder="Search clients…" allowClear
            onCreateNew={() => setQuickClient(true)} createNewLabel="New client" emptyMessage="No clients found." />
        )} />
      </Field>
      {clientId && (
        <Field label="Contact" hint="Who this job's documents address — defaults to the client's primary contact.">
          <Controller control={form.control} name="clientContactId" render={({ field }) => (
            <ComboboxPicker value={field.value || ""} onChange={field.onChange} options={state.contactOptions}
              loading={state.clientContacts === undefined} placeholder="Primary contact (default)" searchPlaceholder="Search contacts…"
              allowClear emptyMessage="This client has no contacts yet." />
          )} />
        </Field>
      )}
      <Field label="Job manager(s)" error={state.membersError ? "Couldn't load org members — you may not have permission to view them." : undefined}>
        <ComboboxPicker value="" onChange={(id) => { if (id && !managerIds.includes(id)) setManagerIds((p) => [...p, id]); }}
          options={memberOptions.filter((m) => !managerIds.includes(m.value))} placeholder="Add manager…" searchPlaceholder="Search members…" emptyMessage="No members found." />
        {managerIds.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-2">
            {managerIds.map((id) => {
              const m = memberOptions.find((x) => x.value === id);
              return (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-paper-2 px-2 py-0.5 text-[12px] text-ink-2">
                  {m?.label ?? id}
                  <button type="button" aria-label="Remove manager" onClick={() => setManagerIds((p) => p.filter((x) => x !== id))} className={cn("rounded-full text-muted transition-colors hover:text-ink", focusRing)}><X className="h-3 w-3" /></button>
                </span>
              );
            })}
          </div>
        )}
      </Field>
      <Field label="Type">
        <Controller control={form.control} name="type" render={({ field }) => (
          <Select value={field.value} onValueChange={field.onChange}>
            <SelectTrigger><SelectValue>{typeName ?? "Other"}</SelectValue></SelectTrigger>
            <SelectContent>{PROJECT_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
        )} />
      </Field>
      <Field label="Description">
        <Textarea {...form.register("description")} placeholder="Brief description of the job" rows={2} />
      </Field>
      <Field label="Tags">
        <Controller name="tags" control={form.control} render={({ field }) => (
          <TagInput value={field.value ?? []} onChange={field.onChange} suggestions={state.orgTags} placeholder="Add tags…" />
        )} />
      </Field>
      <QuickCreateClient open={quickClient} onOpenChange={setQuickClient} onCreated={(id) => form.setValue("clientId", id)} />
    </div>
  );
}

function MoneyFields({ form, state }: { form: UseFormReturn<ProjectFormValues>; state: ProjectFieldsState }) {
  return (
    <div className="mt-5 space-y-5">
      <Field
        label="Discount (%)"
        hint={
          state.selectedClient?.defaultDiscount != null
            ? "From client default — edit anytime. Won't retroactively change if you switch clients again after saving."
            : undefined
        }
      >
        <LockedField
          locked={state.discountLocked}
          reason={state.discountLockReason}
          exitLabel="Unlock financials"
          onExit={scrollToLockStrip}
        >
          <Input
            type="number" step="0.01" min="0" max="100" placeholder="0"
            {...form.register("discountPercent", { onChange: state.markDiscountTouched })}
          />
        </LockedField>
      </Field>
    </div>
  );
}

function WhereFields({ form, state }: { form: UseFormReturn<ProjectFormValues>; state: ProjectFieldsState }) {
  const [quickLocation, setQuickLocation] = useState(false);
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Location">
          <Controller control={form.control} name="locationId" render={({ field }) => (
            <ComboboxPicker value={field.value || ""} onChange={field.onChange} options={state.locationOptions}
              placeholder="Select location…" searchPlaceholder="Search locations…" allowClear
              onCreateNew={() => setQuickLocation(true)} createNewLabel="New location" emptyMessage="No locations found." />
          )} />
        </Field>
      </div>
      <Field label="Contact name"><Input {...form.register("siteContactName")} placeholder="Contact person on site" /></Field>
      <Field label="Contact phone"><Input {...form.register("siteContactPhone")} placeholder="+61 400 000 000" /></Field>
      <div className="sm:col-span-2">
        <Field label="Contact email" error={form.formState.errors.siteContactEmail?.message}>
          <Input type="email" {...form.register("siteContactEmail")} placeholder="contact@example.com" />
        </Field>
      </div>
      <QuickCreateLocation open={quickLocation} onOpenChange={setQuickLocation} onCreated={(id) => form.setValue("locationId", id)} />
    </div>
  );
}

// ─── Schedule fields ───────────────────────────────────────────

/**
 * Two windows (WS2 #941, locked decision): RENTAL (chargeable — what's invoiced)
 * and PROJECT (gear committed — availability/conflicts read this one). Rental is
 * the spine — pick it with a preset or the range calendar. Project defaults to
 * "same as rental" (ghost text, ungenerated — R-3.1) until the user explicitly
 * diverges it. D25: moving the rental dates carries a SET project window by the
 * same offset. Soft (non-blocking) hints flag a window that doesn't contain the
 * rental window.
 */
/** Set the rental range; D25: a SET project window moves by the same offset. */
function applyRentalRange(form: UseFormReturn<ProjectFormValues>, r: DateRange) {
  const cur = form.getValues();
  const winStart = normalizeDate(cur.projectStartDate);
  const winEnd = normalizeDate(cur.projectEndDate);
  const shifted = shiftWindowWithRental(
    { rentalStartDate: normalizeDate(cur.rentalStartDate), rentalEndDate: normalizeDate(cur.rentalEndDate) },
    { rentalStartDate: toDateStr(r.start), rentalEndDate: toDateStr(r.end), projectStartDate: winStart, projectEndDate: winEnd },
  );
  const opts = { shouldDirty: true };
  form.setValue("rentalStartDate", toDateStr(r.start), opts);
  form.setValue("rentalEndDate", toDateStr(r.end), opts);
  if (shifted.projectStartDate !== winStart) form.setValue("projectStartDate", shifted.projectStartDate ?? "", opts);
  if (shifted.projectEndDate !== winEnd) form.setValue("projectEndDate", shifted.projectEndDate ?? "", opts);
}

function PresetChips({ range, onPick }: { range: DateRange; onPick: (r: DateRange) => void }) {
  const lenLabel = rangeLengthLabel(range);
  return (
    <div className="flex flex-wrap gap-2">
      {DURATION_PRESETS.map((p) => {
        const active = lenLabel === (p.days === 0 ? "1 day" : `${p.days + 1} days`);
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => onPick(presetRange(p, range.start))}
            className={cn(
              "rounded-full border-2 px-3 py-1 text-table-cell font-medium transition-colors",
              focusRing,
              active ? "border-red bg-red-soft text-ink" : "border-line text-ink-2 hover:border-red/50 hover:text-ink",
            )}
          >
            {p.label}
          </button>
        );
      })}
      {range.start && (
        <button
          type="button"
          onClick={() => onPick({ start: undefined, end: undefined })}
          className={cn("rounded-full px-3 py-1 text-table-cell font-medium text-muted transition-colors hover:text-t-out", focusRing)}
        >
          Clear
        </button>
      )}
    </div>
  );
}

function rangeSummary(r: DateRange, empty: string): string {
  if (!r.start) return empty;
  const from = format(r.start, "EEE d MMM");
  return r.end ? `${from} → ${format(r.end, "EEE d MMM")}` : `${from} — pick an end date`;
}

/** Soft (non-blocking) hint: a diverging project window is expected to CONTAIN
 *  the rental window. Flag it, don't block — an unusual booking is still valid. */
function windowWarning(range: DateRange, projectRange: DateRange): string | undefined {
  if (projectRange.start && range.start && projectRange.start > range.start) {
    return "The job window starts after the rental window — usually load-in is on or before the rental start.";
  }
  if (projectRange.end && range.end && projectRange.end < range.end) {
    return "The job window ends before the rental window — usually load-out is on or after the rental end.";
  }
  return undefined;
}

function ScheduleFields({ form, busyDays, footer }: { form: UseFormReturn<ProjectFormValues>; busyDays?: ReadonlyMap<string, string>; footer?: React.ReactNode }) {
  const v = form.watch();
  const range: DateRange = { start: fromDateStr(v.rentalStartDate), end: fromDateStr(v.rentalEndDate) };
  const projectRange: DateRange = { start: fromDateStr(v.projectStartDate), end: fromDateStr(v.projectEndDate) };

  const setRange = (r: DateRange) => applyRentalRange(form, r);
  const setProjectRange = (r: DateRange) => {
    form.setValue("projectStartDate", toDateStr(r.start), { shouldDirty: true });
    form.setValue("projectEndDate", toDateStr(r.end), { shouldDirty: true });
  };

  const lenLabel = rangeLengthLabel(range);
  const summary = rangeSummary(range, "No dates yet");
  const projectLenLabel = rangeLengthLabel(projectRange);
  const projectSummary = rangeSummary(projectRange, "Same as rental window");
  const softWarning = windowWarning(range, projectRange);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Rental window</Label>
        <p className="t-micro text-muted">When does the gear leave and come back? This is what gets charged.</p>
      </div>

      <PresetChips range={range} onPick={setRange} />
      <div className="rounded-[var(--r-lg)] border border-line bg-paper-2/40 p-4">
        <RangeCalendar value={range} onChange={setRange} busyDays={busyDays} />
        <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
          <span className={cn("text-table-cell font-medium", range.start ? "text-ink" : "text-muted")}>{summary}</span>
          {lenLabel && (
            <span className="rounded-full bg-red-soft px-2.5 py-0.5 text-[12px] font-semibold text-ink">{lenLabel}</span>
          )}
        </div>
      </div>
      {footer}

      <Accordion type="single" collapsible defaultValue={projectRange.start ? "project-window" : undefined}>
        <AccordionItem value="project-window" className="border-line">
          <AccordionTrigger>
            Job window
            {!projectRange.start && <span className="ml-2 t-micro font-normal text-muted">(same as rental)</span>}
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3 pt-1">
              <p className="t-micro text-muted">
                When the gear is actually committed — set this only if load-in/load-out fall outside the rental
                window (e.g. an earlier bump-in or a later strike).
              </p>
              <div className="rounded-[var(--r-lg)] border border-line bg-paper-2/40 p-4">
                <RangeCalendar value={projectRange} onChange={setProjectRange} />
                <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
                  <span className={cn("text-table-cell font-medium", projectRange.start ? "text-ink" : "text-muted")}>
                    {projectSummary}
                  </span>
                  <div className="flex items-center gap-2">
                    {projectLenLabel && (
                      <span className="rounded-full bg-red-soft px-2.5 py-0.5 text-[12px] font-semibold text-ink">{projectLenLabel}</span>
                    )}
                    {projectRange.start && (
                      <button
                        type="button"
                        onClick={() => setProjectRange({ start: undefined, end: undefined })}
                        className={cn("rounded-full px-2.5 py-0.5 text-[12px] font-medium text-muted transition-colors hover:text-t-out", focusRing)}
                      >
                        Reset to rental
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {softWarning && (
                <p className="t-micro text-red-text" role="status">{softWarning}</p>
              )}
              <div className="space-y-4 pt-1">
                <MomentRow icon={Truck} label="Job starts" dateName="projectStartDate" timeName="projectStartTime" form={form} />
                <MomentRow icon={Truck} label="Job ends" dateName="projectEndDate" timeName="projectEndTime" form={form} />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

function MomentRow({
  icon: Icon, label, dateName, timeName, form,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  dateName: Path<ProjectFormValues>;
  timeName: Path<ProjectFormValues>;
  form: UseFormReturn<ProjectFormValues>;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--r)] bg-paper-2 text-muted">
        <Icon className="h-4 w-4" />
      </span>
      <span className="w-24 shrink-0 text-table-cell font-medium text-ink-2">{label}</span>
      <Input type="date" aria-label={`${label} date`} {...form.register(dateName)} className="flex-1" />
      <Input type="time" aria-label={`${label} time`} {...form.register(timeName)} className="w-28" />
    </div>
  );
}

function Field({ label, required, hint, error, children }: { label: string; required?: boolean; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}{required && <span className="text-red-text"> *</span>}</Label>
      {children}
      {hint && !error && <p className="t-micro text-muted">{hint}</p>}
      {error && <p className="t-micro text-t-out">{error}</p>}
    </div>
  );
}
