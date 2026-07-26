"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller, type Path, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format, parseISO, isValid } from "date-fns";
import { Loader2, X, Check, ArrowLeft, ArrowRight, Sparkles, Truck } from "lucide-react";
import { toast } from "sonner";
import { cn, focusRing, disabledState } from "@/lib/utils";
import {
  RangeCalendar, DURATION_PRESETS, presetRange, rangeLengthLabel, type DateRange,
} from "@/components/ui/range-calendar";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import { projectSchema, type ProjectFormValues } from "@/lib/validations/project";
import { peekNextProjectNumber, checkProjectNumberAvailable } from "@/server/projects";
import { useProjectWrites } from "@/hooks/use-native-project-writes";
import { useProjectManagerWrites } from "@/hooks/use-project-managers-writes";
import { useClientSearch, useClient } from "@/hooks/use-clients";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useLocations } from "@/hooks/use-locations";
import { useOrgTags } from "@/hooks/use-org-tags";
import { getOrgMembers } from "@/server/org-members";
import { useActiveOrganization } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { TagInput } from "@/components/ui/tag-input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { QuickCreateClient } from "@/components/clients/quick-create-client";
import { QuickCreateLocation } from "@/components/assets/quick-create-location";

const TYPE_OPTIONS = [
  { value: "DRY_HIRE", label: "Dry hire" }, { value: "WET_HIRE", label: "Wet hire" },
  { value: "INSTALLATION", label: "Installation" }, { value: "TOUR", label: "Tour" },
  { value: "CORPORATE", label: "Corporate" }, { value: "THEATRE", label: "Theatre" },
  { value: "FESTIVAL", label: "Festival" }, { value: "CONFERENCE", label: "Conference" },
  { value: "OTHER", label: "Other" },
] as const;

const STATUS_OPTIONS = [
  { value: "ENQUIRY", label: "Enquiry" }, { value: "QUOTING", label: "Quoting" },
  { value: "QUOTED", label: "Quoted" }, { value: "CONFIRMED", label: "Confirmed" },
  { value: "PREPPING", label: "Prepping" }, { value: "CHECKED_OUT", label: "Checked out" },
  { value: "ON_SITE", label: "On site" }, { value: "RETURNED", label: "Returned" },
  { value: "COMPLETED", label: "Completed" }, { value: "INVOICED", label: "Invoiced" },
  { value: "CANCELLED", label: "Cancelled" },
] as const;

/**
 * The project detail shape the wizard needs in edit mode. Loosely typed (all
 * optional, dates as `unknown`) so the page can pass its `useProjectDetail`
 * composite straight through — the wizard normalises everything to the form's
 * `yyyy-MM-dd` / `HH:mm` string shape itself.
 */
export interface EditableProject {
  id: string;
  projectNumber?: string | null;
  name?: string | null;
  clientId?: string | null;
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
  depositPercent?: number | string | null;
  depositPaid?: number | string | null;
  invoicedTotal?: number | string | null;
  tags?: string[] | null;
  isTemplate?: boolean;
  projectManagers?: { user: { id: string } }[];
}

type StepKey = "basics" | "schedule" | "site" | "review";
const STEPS: { key: StepKey; label: string; tip: string; fields: Path<ProjectFormValues>[] }[] = [
  { key: "basics", label: "Basics", tip: "Name it, aim it at a client, and you're rolling — tighten the rest as the gig firms up.", fields: ["name", "projectNumber", "clientId", "type", "description", "tags"] },
  { key: "schedule", label: "Schedule", tip: "Rough dates are fine. You can tighten the project window later.", fields: ["rentalStartDate", "rentalEndDate", "projectStartDate", "projectStartTime", "projectEndDate", "projectEndTime"] },
  { key: "site", label: "Site", tip: "Where it's happening and who to call on the day. All optional.", fields: ["locationId", "siteContactName", "siteContactPhone", "siteContactEmail"] },
  { key: "review", label: "Review", tip: "Looks right? Create the job and start adding gear.", fields: [] },
];

export function ProjectWizard({
  isTemplate: isTemplateProp,
  project,
}: {
  isTemplate?: boolean;
  /** When present, the wizard runs in EDIT mode for this project. */
  project?: EditableProject;
}) {
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const managerWrites = useProjectManagerWrites();
  const orgId = activeOrg?.id;
  const projectWrites = useProjectWrites(orgId);

  const isEditing = !!project;
  const isTemplate = isTemplateProp ?? project?.isTemplate ?? false;

  const initialManagerIds = (project?.projectManagers ?? []).map((pm) => pm.user.id);

  const [step, setStep] = useState(0);
  const [quickClient, setQuickClient] = useState(false);
  const [quickLocation, setQuickLocation] = useState(false);
  const [managerIds, setManagerIds] = useState<string[]>(initialManagerIds);

  // WCAG "focus is never silently lost" (R-8.1.7, #894): the just-clicked
  // Continue/Back button unmounts on step change, and without an explicit
  // target focus falls back to document.body. Land it on the new step's
  // heading instead. Step 0 is excluded — its Name field already autoFocuses
  // on (re)mount, which fires during commit, before this effect would run.
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const isInitialStepRender = useRef(true);
  useEffect(() => {
    if (isInitialStepRender.current) {
      isInitialStepRender.current = false;
      return;
    }
    if (step !== 0) stepHeadingRef.current?.focus();
  }, [step]);

  const { data: nextProjectNumber } = useServerQuery({
    queryKey: ["project-number-next", orgId],
    queryFn: () => peekNextProjectNumber(),
    enabled: !isTemplate && !isEditing && !!orgId,
  });

  // Phase 7 — native INDEXED client search (bounded, reactive) instead of loading the
  // whole org list to JS-filter. Debounced as the user types.
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

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: project
      ? {
          projectNumber: project.projectNumber ?? "",
          name: project.name ?? "",
          clientId: project.clientId ?? "",
          status: project.status ?? "ENQUIRY",
          type: project.type ?? "OTHER",
          description: project.description ?? "",
          locationId: project.locationId ?? "",
          siteContactName: project.siteContactName ?? "",
          siteContactPhone: project.siteContactPhone ?? "",
          siteContactEmail: project.siteContactEmail ?? "",
          // Dates → the form's "yyyy-MM-dd" string shape; times stay "HH:mm".
          // loadInDate/loadOutDate/eventStartDate/eventEndDate are DEPRECATED — the
          // wizard reads them for a pre-WS2 project (so an old value isn't silently
          // dropped) but never writes them; project*/rental* are the two windows now.
          loadInDate: normalizeDate(project.loadInDate),
          loadInTime: project.loadInTime ?? "",
          eventStartDate: normalizeDate(project.eventStartDate),
          eventStartTime: project.eventStartTime ?? "",
          eventEndDate: normalizeDate(project.eventEndDate),
          eventEndTime: project.eventEndTime ?? "",
          loadOutDate: normalizeDate(project.loadOutDate),
          loadOutTime: project.loadOutTime ?? "",
          projectStartDate: normalizeDate(project.projectStartDate),
          projectStartTime: project.projectStartTime ?? "",
          projectEndDate: normalizeDate(project.projectEndDate),
          projectEndTime: project.projectEndTime ?? "",
          rentalStartDate: normalizeDate(project.rentalStartDate),
          rentalEndDate: normalizeDate(project.rentalEndDate),
          crewNotes: project.crewNotes ?? "",
          internalNotes: project.internalNotes ?? "",
          clientNotes: project.clientNotes ?? "",
          discountPercent: project.discountPercent != null ? Number(project.discountPercent) : undefined,
          depositPercent: project.depositPercent != null ? Number(project.depositPercent) : undefined,
          depositPaid: project.depositPaid != null ? Number(project.depositPaid) : undefined,
          invoicedTotal: project.invoicedTotal != null ? Number(project.invoicedTotal) : undefined,
          tags: project.tags ?? [],
        }
      : {
          projectNumber: "", name: "", clientId: "", status: "ENQUIRY", type: "OTHER",
          description: "", locationId: "", siteContactName: "", siteContactPhone: "", siteContactEmail: "",
          loadInDate: undefined, loadInTime: "", eventStartDate: undefined, eventStartTime: "",
          eventEndDate: undefined, eventEndTime: "", loadOutDate: undefined, loadOutTime: "",
          projectStartDate: undefined, projectStartTime: "", projectEndDate: undefined, projectEndTime: "",
          rentalStartDate: undefined, rentalEndDate: undefined,
          crewNotes: "", internalNotes: "", clientNotes: "", tags: [],
        },
  });

  const v = form.watch();
  // Resolve the selected client's label directly (it may not be in the current search page).
  const selectedClientName = useClient(v.clientId || undefined)?.name;

  // Pre-fill the project code from the org's next sequence so the (now required)
  // field is populated by default — the user accepts it or types their own.
  useEffect(() => {
    if (nextProjectNumber && !form.getValues("projectNumber")) {
      form.setValue("projectNumber", nextProjectNumber);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextProjectNumber]);

  const mutation = useServerMutation({
    mutationFn: async (data: ProjectFormValues) => {
      // Inline duplicate-code guard: a thrown DUPLICATE_PROJECT_CODE error is
      // masked to the generic "Server Components render" string in production, so
      // check availability up-front (a return value survives the boundary) and
      // raise a client-side error tagged with the field for an inline message.
      if (!isTemplate && data.projectNumber?.trim()) {
        const { available } = await checkProjectNumberAvailable(
          data.projectNumber.trim(),
          project?.id,
        );
        if (!available) {
          throw Object.assign(
            new Error(`Project code "${data.projectNumber.trim()}" is already in use.`),
            { field: "projectNumber" as const },
          );
        }
      }

      const result = project
        ? await projectWrites.update(project.id, data, isTemplate)
        : await projectWrites.create({ ...data, isTemplate });

      // Reconcile managers to the full selected set in one call — the server
      // diffs against the current rows (create mode = add all; edit mode = add
      // /remove only the delta). Was a Promise.all fan-out of one round-trip per
      // changed manager. Only call when the set actually changed: setProjectManagers
      // needs project:manage, and an unchanged save must stay a pure
      // create/update (a non-owner without manage permission would otherwise fail
      // on a manager no-op).
      const managersChanged =
        managerIds.length !== initialManagerIds.length ||
        managerIds.some((id) => !initialManagerIds.includes(id));
      if (managersChanged) {
        await managerWrites.set(result.id, managerIds);
      }
      return result;
    },
    onSuccess: (result) => {
      toast.success(
        isEditing
          ? isTemplate ? "Template updated" : "Job updated"
          : isTemplate ? "Template created" : "Job created",
      );
      router.push(`/projects/${result.id}`);
    },
    onError: (e) => {
      // A field-tagged error (e.g. duplicate project code) surfaces inline on the
      // right input; projectNumber lives on step 0, so make it visible first.
      const field = (e as { field?: string }).field;
      if (field) {
        setStep(0);
        form.setError(field as "projectNumber", { type: "server", message: e.message });
        form.setFocus(field as "projectNumber");
        return;
      }
      toast.error(e.message);
    },
  });

  const next = async () => {
    const ok = await form.trigger(STEPS[step].fields);
    // Project code is required (schema allows blank for auto-gen, so enforce here).
    if (step === 0 && !isTemplate && !form.getValues("projectNumber")?.trim()) {
      form.setError("projectNumber", { type: "manual", message: "Project code is required." });
      return;
    }
    if (ok) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  // Prefer the getById-resolved name (the selected client may be off the current
  // bounded search page — e.g. editing an older project or after another search).
  const clientName = selectedClientName ?? clientOptions.find((c) => c.value === v.clientId)?.label;
  const locationName = locationOptions.find((l) => l.value === v.locationId)?.label;
  const typeName = TYPE_OPTIONS.find((t) => t.value === v.type)?.label;

  return (
    <>
      {/* Step header */}
      <ol className="flex items-center gap-2">
        {STEPS.map((s, i) => {
          const done = i < step;
          const active = i === step;
          // Edit mode: all steps are pre-validated, so any step is reachable.
          const reachable = isEditing || i <= step;
          return (
            <li key={s.key} className="flex flex-1 items-center gap-2">
              <button
                type="button"
                onClick={() => reachable && setStep(i)}
                disabled={!reachable}
                className={cn("flex items-center gap-2 rounded-[var(--r)] px-1 py-1 transition-colors", focusRing, disabledState, reachable && "cursor-pointer")}
              >
                <span className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold transition-colors",
                  done ? "bg-red text-white" : active ? "border-2 border-red text-red" : "border-2 border-line text-faint",
                )}>
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className={cn("text-table-cell font-medium", active ? "text-ink" : done ? "text-ink-2" : "text-faint")}>{s.label}</span>
              </button>
              {i < STEPS.length - 1 && <span className={cn("h-px flex-1", done ? "bg-red" : "bg-line")} />}
            </li>
          );
        })}
      </ol>

      <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="mt-6 grid gap-6 lg:grid-cols-[1fr_280px]">
        {/* Step content */}
        <div className="rounded-[var(--r-lg)] border border-line bg-card p-5 shadow-[var(--sh-card)] sm:p-6">
          <h2
            ref={stepHeadingRef}
            tabIndex={-1}
            className={cn("t-overline mb-4 rounded-[var(--r)] text-faint", focusRing)}
          >
            Step {step + 1}: {STEPS[step].label}
          </h2>
          {step === 0 && (
            <div className="space-y-5">
              <Field label="Name" required error={form.formState.errors.name?.message}>
                <Input {...form.register("name")} placeholder="e.g. Summer Festival 2026" autoFocus />
              </Field>
              {!isTemplate && (
                <Field label="Project code" required hint="Pre-filled from your next sequence — edit if you need a custom code." error={form.formState.errors.projectNumber?.message}>
                  <Input {...form.register("projectNumber")} placeholder={nextProjectNumber ? `Auto: ${nextProjectNumber}` : "e.g. PROJ-2026-0001"} className="font-mono" />
                </Field>
              )}
              <Field label="Client">
                <Controller control={form.control} name="clientId" render={({ field }) => (
                  <ComboboxPicker value={field.value || ""} onChange={field.onChange} options={clientOptions}
                    onSearchChange={setClientQuery} loading={clients === undefined} selectedLabel={selectedClientName}
                    placeholder="Select client…" searchPlaceholder="Search clients…" allowClear
                    onCreateNew={() => setQuickClient(true)} createNewLabel="New client" emptyMessage="No clients found." />
                )} />
              </Field>
              <Field label="Project manager(s)" error={membersError ? "Couldn't load org members — you may not have permission to view them." : undefined}>
                <ComboboxPicker value="" onChange={(id) => { if (id && !managerIds.includes(id)) setManagerIds((p) => [...p, id]); }}
                  options={memberOptions.filter((m) => !managerIds.includes(m.value))} placeholder="Add manager…" searchPlaceholder="Search members…" emptyMessage="No members found." />
                {managerIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-2">
                    {managerIds.map((id) => {
                      const m = memberOptions.find((x) => x.value === id);
                      return (
                        <span key={id} className="inline-flex items-center gap-1 rounded-full bg-paper-2 px-2 py-0.5 text-[12px] text-ink-2">
                          {m?.label ?? id}
                          <button type="button" aria-label="Remove manager" onClick={() => setManagerIds((p) => p.filter((x) => x !== id))} className={cn("rounded-full text-faint transition-colors hover:text-ink", focusRing)}><X className="h-3 w-3" /></button>
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
                    <SelectContent>{TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                  </Select>
                )} />
              </Field>
              {isEditing && (
                <Field label="Status">
                  <Controller control={form.control} name="status" render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue>{STATUS_OPTIONS.find((o) => o.value === field.value)?.label ?? field.value}</SelectValue></SelectTrigger>
                      <SelectContent>{STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                  )} />
                </Field>
              )}
              <Field label="Description">
                <Textarea {...form.register("description")} placeholder="Brief description of the job" rows={2} />
              </Field>
              <Field label="Tags">
                <Controller name="tags" control={form.control} render={({ field }) => (
                  <TagInput value={field.value ?? []} onChange={field.onChange} suggestions={orgTags} placeholder="Add tags…" />
                )} />
              </Field>
            </div>
          )}

          {step === 1 && <ScheduleStep form={form} />}

          {step === 2 && (
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Location">
                  <Controller control={form.control} name="locationId" render={({ field }) => (
                    <ComboboxPicker value={field.value || ""} onChange={field.onChange} options={locationOptions}
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
              {isEditing && (
                <>
                  <div className="space-y-3 border-t border-line pt-4 sm:col-span-2">
                    <p className="t-overline text-faint">Financial</p>
                  </div>
                  <Field label="Discount (%)"><Input type="number" step="0.01" min="0" max="100" {...form.register("discountPercent")} placeholder="0" /></Field>
                  <Field label="Deposit (%)"><Input type="number" step="0.01" min="0" max="100" {...form.register("depositPercent")} placeholder="0" /></Field>
                  <Field label="Deposit paid ($)"><Input type="number" step="0.01" min="0" {...form.register("depositPaid")} placeholder="0.00" /></Field>
                  <Field label="Invoiced total ($)"><Input type="number" step="0.01" min="0" {...form.register("invoicedTotal")} placeholder="0.00" /></Field>
                </>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="font-display text-section-header font-bold text-ink">{v.name || "Untitled job"}</h2>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <ReviewRow label="Client" value={clientName} />
                <ReviewRow label="Type" value={typeName} />
                <ReviewRow label="Managers" value={managerIds.length ? `${managerIds.length} assigned` : undefined} />
                <ReviewRow label="Project code" value={v.projectNumber || (nextProjectNumber ? `Auto: ${nextProjectNumber}` : undefined)} mono />
                <ReviewRow label="Rental" value={dateRange(v.rentalStartDate, v.rentalEndDate)} />
                <ReviewRow label="Project window" value={dateRange(v.projectStartDate, v.projectEndDate) || "Same as rental"} />
                <ReviewRow label="Location" value={locationName} />
                <ReviewRow label="Site contact" value={v.siteContactName} />
                <ReviewRow label="Tags" value={(v.tags && v.tags.length) ? v.tags.join(", ") : undefined} />
              </dl>
            </div>
          )}

          {/* Footer nav */}
          <div className="mt-6 flex items-center justify-between border-t border-line pt-4">
            <Button type="button" variant="ghost" onClick={step === 0 ? () => router.back() : back}>
              <ArrowLeft className="h-4 w-4" /> {step === 0 ? "Cancel" : "Back"}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button type="button" variant="primary" onClick={next}>Continue <ArrowRight className="h-4 w-4" /></Button>
            ) : (
              <Button type="submit" variant="halo" disabled={mutation.isPending}>
                {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {isEditing ? "Save changes" : isTemplate ? "Create template" : "Create job"}
              </Button>
            )}
          </div>
        </div>

        {/* Helper rail */}
        <aside className="hidden lg:block">
          <div className="sticky top-4 space-y-4 rounded-[var(--r-lg)] border border-line bg-paper-2/50 p-4">
            <div>
              <p className="t-overline text-faint">Step {step + 1} of {STEPS.length}</p>
              <p className="mt-1 font-hand text-[15px] text-t-out">{STEPS[step].tip}</p>
            </div>
            <div className="space-y-2 border-t border-line pt-3">
              <p className="t-overline text-faint">So far</p>
              <SummaryLine label="Name" value={v.name || "—"} />
              <SummaryLine label="Client" value={clientName || "—"} />
              <SummaryLine label="Type" value={typeName || "—"} />
              <SummaryLine label="Dates" value={dateRange(v.rentalStartDate, v.rentalEndDate) || "—"} />
            </div>
          </div>
        </aside>
      </form>

      <QuickCreateClient open={quickClient} onOpenChange={setQuickClient} onCreated={(id) => form.setValue("clientId", id)} />
      <QuickCreateLocation open={quickLocation} onOpenChange={setQuickLocation} onCreated={(id) => form.setValue("locationId", id)} />
    </>
  );
}

// ─── Schedule step ─────────────────────────────────────────────

const toDateStr = (d?: Date) => (d ? format(d, "yyyy-MM-dd") : "");
function fromDateStr(s?: unknown): Date | undefined {
  if (!s) return undefined;
  const d = typeof s === "string" ? parseISO(s) : new Date(String(s));
  return isValid(d) ? d : undefined;
}

/**
 * Normalise a project's stored date (ISO string, Date, or null) to the form's
 * "yyyy-MM-dd" string shape. `undefined` when absent so empty fields stay empty.
 */
function normalizeDate(value?: unknown): string | undefined {
  const d = fromDateStr(value);
  return d ? toDateStr(d) : undefined;
}

/**
 * Two windows (WS2 #941, locked decision): RENTAL (chargeable — what's invoiced)
 * and PROJECT (gear committed — when equipment leaves/returns the warehouse;
 * availability/conflicts read this one). Rental is the spine — pick it with a
 * preset or the range calendar. Project defaults to "same as rental" (ghost text,
 * ungenerated — R-3.1: it stays genuinely blank in the form/DB, not a copy) until
 * the user explicitly diverges it, e.g. an earlier load-in or later load-out than
 * the charged dates. Soft (non-blocking) hints flag when the project window
 * doesn't fully contain the rental window — that's unusual, not necessarily wrong.
 */
function ScheduleStep({ form }: { form: UseFormReturn<ProjectFormValues> }) {
  const v = form.watch();
  const range: DateRange = {
    start: fromDateStr(v.rentalStartDate),
    end: fromDateStr(v.rentalEndDate),
  };
  const projectRange: DateRange = {
    start: fromDateStr(v.projectStartDate),
    end: fromDateStr(v.projectEndDate),
  };

  const setRange = (r: DateRange) => {
    form.setValue("rentalStartDate", toDateStr(r.start), { shouldDirty: true });
    form.setValue("rentalEndDate", toDateStr(r.end), { shouldDirty: true });
  };
  const setProjectRange = (r: DateRange) => {
    form.setValue("projectStartDate", toDateStr(r.start), { shouldDirty: true });
    form.setValue("projectEndDate", toDateStr(r.end), { shouldDirty: true });
  };

  const lenLabel = rangeLengthLabel(range);
  const summary = range.start
    ? range.end
      ? `${format(range.start, "EEE d MMM")} → ${format(range.end, "EEE d MMM")}`
      : `${format(range.start, "EEE d MMM")} — pick an end date`
    : "No dates yet";

  const projectLenLabel = rangeLengthLabel(projectRange);
  const projectSummary = projectRange.start
    ? projectRange.end
      ? `${format(projectRange.start, "EEE d MMM")} → ${format(projectRange.end, "EEE d MMM")}`
      : `${format(projectRange.start, "EEE d MMM")} — pick an end date`
    : "Same as rental window";

  // Soft (non-blocking) hint: a diverging project window is expected to CONTAIN
  // the rental window (gear leaves before/at the charged start, returns after/at
  // the charged end). Flag it, don't block — an unusual booking is still valid.
  const softWarning =
    projectRange.start && range.start && projectRange.start > range.start
      ? "The project window starts after the rental window — usually load-in is on or before the rental start."
      : projectRange.end && range.end && projectRange.end < range.end
        ? "The project window ends before the rental window — usually load-out is on or after the rental end."
        : undefined;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Rental window</Label>
        <p className="t-micro text-muted">When does the gear leave and come back? This is what gets charged.</p>
      </div>

      {/* Duration presets */}
      <div className="flex flex-wrap gap-2">
        {DURATION_PRESETS.map((p) => {
          const active = lenLabel === (p.days === 0 ? "1 day" : `${p.days + 1} days`);
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => setRange(presetRange(p, range.start))}
              className={cn(
                "rounded-full border-2 px-3 py-1 text-table-cell font-medium transition-colors",
                focusRing,
                active
                  ? "border-red bg-red-soft text-ink"
                  : "border-line text-ink-2 hover:border-red/50 hover:text-ink",
              )}
            >
              {p.label}
            </button>
          );
        })}
        {range.start && (
          <button
            type="button"
            onClick={() => setRange({ start: undefined, end: undefined })}
            className={cn("rounded-full px-3 py-1 text-table-cell font-medium text-faint transition-colors hover:text-t-out", focusRing)}
          >
            Clear
          </button>
        )}
      </div>

      {/* Calendar + live summary */}
      <div className="rounded-[var(--r-lg)] border border-line bg-paper-2/40 p-4">
        <RangeCalendar value={range} onChange={setRange} />
        <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
          <span className={cn("text-table-cell font-medium", range.start ? "text-ink" : "text-faint")}>{summary}</span>
          {lenLabel && (
            <span className="rounded-full bg-red-soft px-2.5 py-0.5 text-[12px] font-semibold text-ink">{lenLabel}</span>
          )}
        </div>
      </div>

      {/* Project window — blank by default ("same as rental"), diverges only when set */}
      <Accordion type="single" collapsible defaultValue={projectRange.start ? "project-window" : undefined}>
        <AccordionItem value="project-window" className="border-line">
          <AccordionTrigger>
            Project window
            {!projectRange.start && <span className="ml-2 t-micro font-normal text-faint">(same as rental)</span>}
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
                  <span className={cn("text-table-cell font-medium", projectRange.start ? "text-ink" : "text-faint")}>
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
                        className={cn("rounded-full px-2.5 py-0.5 text-[12px] font-medium text-faint transition-colors hover:text-t-out", focusRing)}
                      >
                        Reset to rental
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {softWarning && (
                <p className="t-micro text-red" role="status">{softWarning}</p>
              )}
              <div className="space-y-4 pt-1">
                <MomentRow icon={Truck} label="Project starts" dateName="projectStartDate" timeName="projectStartTime" form={form} />
                <MomentRow icon={Truck} label="Project ends" dateName="projectEndDate" timeName="projectEndTime" form={form} />
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

// ─── Field helpers ─────────────────────────────────────────────

function Field({ label, required, hint, error, children }: { label: string; required?: boolean; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}{required && <span className="text-red"> *</span>}</Label>
      {children}
      {hint && !error && <p className="t-micro text-muted">{hint}</p>}
      {error && <p className="t-micro text-t-out">{error}</p>}
    </div>
  );
}

function ReviewRow({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line pb-2">
      <dt className="t-micro text-faint">{label}</dt>
      <dd className={cn("text-ui-text", value ? "text-ink" : "text-faint", mono && "font-mono text-caption")}>{value || "Not set"}</dd>
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="t-micro shrink-0 text-muted">{label}</span>
      <span className="truncate text-[12px] font-medium text-ink-2">{value}</span>
    </div>
  );
}

function dateRange(a?: unknown, b?: unknown): string | undefined {
  const fmt = (s?: unknown) => {
    if (!s) return null;
    const d = new Date(String(s));
    return isNaN(d.getTime()) ? null : d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  };
  const x = fmt(a), y = fmt(b);
  if (x && y) return `${x} – ${y}`;
  return x || y || undefined;
}
