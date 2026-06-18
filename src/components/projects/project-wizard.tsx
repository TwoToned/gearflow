"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, X, Check, ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import { projectSchema, type ProjectFormValues } from "@/lib/validations/project";
import { createProject, peekNextProjectNumber } from "@/server/projects";
import { addProjectManager } from "@/server/project-managers";
import { useClients } from "@/hooks/use-clients";
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

type StepKey = "basics" | "schedule" | "site" | "review";
const STEPS: { key: StepKey; label: string; tip: string; fields: Path<ProjectFormValues>[] }[] = [
  { key: "basics", label: "Basics", tip: "Just the essentials — a name and (ideally) the client. Everything else can wait.", fields: ["name", "projectNumber", "clientId", "type", "description", "tags"] },
  { key: "schedule", label: "Schedule", tip: "Rough dates are fine. You can tighten load-in / load-out later.", fields: ["rentalStartDate", "rentalEndDate", "loadInDate", "loadInTime", "loadOutDate", "loadOutTime", "eventStartDate", "eventStartTime", "eventEndDate", "eventEndTime"] },
  { key: "site", label: "Site", tip: "Where it's happening and who to call on the day. All optional.", fields: ["locationId", "siteContactName", "siteContactPhone", "siteContactEmail"] },
  { key: "review", label: "Review", tip: "Looks right? Create the job and start adding gear.", fields: [] },
];

export function ProjectWizard({ isTemplate = false }: { isTemplate?: boolean }) {
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const [step, setStep] = useState(0);
  const [quickClient, setQuickClient] = useState(false);
  const [quickLocation, setQuickLocation] = useState(false);
  const [managerIds, setManagerIds] = useState<string[]>([]);

  const { data: nextProjectNumber } = useServerQuery({
    queryKey: ["project-number-next", orgId],
    queryFn: () => peekNextProjectNumber(),
    enabled: !isTemplate && !!orgId,
  });

  const clients = useClients(orgId);
  const clientOptions = (clients ?? []).map((c) => ({ value: c.id, label: c.name, description: c.contactName || undefined }));
  const rawLocations = useLocations(orgId) ?? [];
  const locNameById = new Map(rawLocations.map((l) => [l.id, l.name]));
  const locationOptions = rawLocations.map((l) => ({ value: l.id, label: l.parentId ? `${locNameById.get(l.parentId) ?? ""} → ${l.name}` : l.name, description: l.address || undefined }));
  const orgTags = useOrgTags(orgId);
  const { data: membersData } = useServerQuery({ queryKey: ["org-members", orgId], queryFn: () => getOrgMembers({ pageSize: 200 }) });
  const memberOptions = (membersData?.members || []).map((m) => ({ value: m.user.id, label: m.user.name || m.user.email, description: m.user.name ? m.user.email : undefined }));

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      projectNumber: "", name: "", clientId: "", status: "ENQUIRY", type: "OTHER",
      description: "", locationId: "", siteContactName: "", siteContactPhone: "", siteContactEmail: "",
      loadInDate: undefined, loadInTime: "", eventStartDate: undefined, eventStartTime: "",
      eventEndDate: undefined, eventEndTime: "", loadOutDate: undefined, loadOutTime: "",
      rentalStartDate: undefined, rentalEndDate: undefined,
      crewNotes: "", internalNotes: "", clientNotes: "", tags: [],
    },
  });

  const v = form.watch();

  const mutation = useServerMutation({
    mutationFn: async (data: ProjectFormValues) => {
      const result = await createProject({ ...data, isTemplate });
      await Promise.all(managerIds.map((userId) => addProjectManager(result.id, userId)));
      return result;
    },
    onSuccess: (result) => {
      toast.success(isTemplate ? "Template created" : "Job created");
      router.push(`/projects/${result.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const next = async () => {
    const ok = await form.trigger(STEPS[step].fields);
    if (ok) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const clientName = clientOptions.find((c) => c.value === v.clientId)?.label;
  const locationName = locationOptions.find((l) => l.value === v.locationId)?.label;
  const typeName = TYPE_OPTIONS.find((t) => t.value === v.type)?.label;

  return (
    <>
      {/* Step header */}
      <ol className="flex items-center gap-2">
        {STEPS.map((s, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <li key={s.key} className="flex flex-1 items-center gap-2">
              <button
                type="button"
                onClick={() => i <= step && setStep(i)}
                disabled={i > step}
                className={cn("flex items-center gap-2 rounded-[var(--r)] px-1 py-1 transition-colors", i <= step && "cursor-pointer")}
              >
                <span className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold transition-colors",
                  done ? "bg-red text-white" : active ? "border-2 border-red text-red" : "border-2 border-line text-faint",
                )}>
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className={cn("text-[13px] font-medium", active ? "text-ink" : done ? "text-ink-2" : "text-faint")}>{s.label}</span>
              </button>
              {i < STEPS.length - 1 && <span className={cn("h-px flex-1", done ? "bg-red" : "bg-line")} />}
            </li>
          );
        })}
      </ol>

      <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="mt-6 grid gap-6 lg:grid-cols-[1fr_280px]">
        {/* Step content */}
        <div className="rounded-[var(--r-lg)] border border-line bg-card p-5 shadow-[var(--sh-card)] sm:p-6">
          {step === 0 && (
            <div className="space-y-5">
              <Field label="Name" required error={form.formState.errors.name?.message}>
                <Input {...form.register("name")} placeholder="e.g. Summer Festival 2026" autoFocus />
              </Field>
              {!isTemplate && (
                <Field label="Project code" hint={nextProjectNumber ? `Leave blank to auto-generate (next: ${nextProjectNumber})` : undefined} error={form.formState.errors.projectNumber?.message}>
                  <Input {...form.register("projectNumber")} placeholder={nextProjectNumber ? `Auto: ${nextProjectNumber}` : "e.g. PROJ-2026-0001"} className="font-mono" />
                </Field>
              )}
              <Field label="Client">
                <Controller control={form.control} name="clientId" render={({ field }) => (
                  <ComboboxPicker value={field.value || ""} onChange={field.onChange} options={clientOptions}
                    placeholder="Select client…" searchPlaceholder="Search clients…" allowClear
                    onCreateNew={() => setQuickClient(true)} createNewLabel="New client" emptyMessage="No clients found." />
                )} />
              </Field>
              <Field label="Project manager(s)">
                <ComboboxPicker value="" onChange={(id) => { if (id && !managerIds.includes(id)) setManagerIds((p) => [...p, id]); }}
                  options={memberOptions.filter((m) => !managerIds.includes(m.value))} placeholder="Add manager…" searchPlaceholder="Search members…" emptyMessage="No members found." />
                {managerIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-2">
                    {managerIds.map((id) => {
                      const m = memberOptions.find((x) => x.value === id);
                      return (
                        <span key={id} className="inline-flex items-center gap-1 rounded-full bg-paper-2 px-2 py-0.5 text-[12px] text-ink-2">
                          {m?.label ?? id}
                          <button type="button" onClick={() => setManagerIds((p) => p.filter((x) => x !== id))} className="text-faint hover:text-ink"><X className="h-3 w-3" /></button>
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

          {step === 1 && (
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Rental start"><Input type="date" {...form.register("rentalStartDate")} /></Field>
              <Field label="Rental end"><Input type="date" {...form.register("rentalEndDate")} /></Field>
              <DateTime label="Load in" dateName="loadInDate" timeName="loadInTime" form={form} />
              <DateTime label="Load out" dateName="loadOutDate" timeName="loadOutTime" form={form} />
              <DateTime label="Event start" dateName="eventStartDate" timeName="eventStartTime" form={form} />
              <DateTime label="Event end" dateName="eventEndDate" timeName="eventEndTime" form={form} />
            </div>
          )}

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
                <ReviewRow label="Event" value={dateRange(v.eventStartDate, v.eventEndDate)} />
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
                {isTemplate ? "Create template" : "Create job"}
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

function DateTime({ label, dateName, timeName, form }: { label: string; dateName: Path<ProjectFormValues>; timeName: Path<ProjectFormValues>; form: ReturnType<typeof useForm<ProjectFormValues>> }) {
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <Input type="date" {...form.register(dateName)} className="flex-1" />
        <Input type="time" {...form.register(timeName)} className="w-28" />
      </div>
    </Field>
  );
}

function ReviewRow({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line pb-2">
      <dt className="t-micro text-faint">{label}</dt>
      <dd className={cn("text-[14px]", value ? "text-ink" : "text-faint", mono && "font-mono text-[13px]")}>{value || "Not set"}</dd>
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
