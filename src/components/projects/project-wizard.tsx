"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Check, ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn, focusRing, disabledState } from "@/lib/utils";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { projectSchema, type ProjectFormValues } from "@/lib/validations/project";
import { checkProjectNumberAvailable } from "@/server/projects";
import { useProjectWrites } from "@/hooks/use-native-project-writes";
import { useProjectManagerWrites } from "@/hooks/use-project-managers-writes";
import { useActiveOrganization } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { useDateMoveGate } from "@/hooks/use-date-move-gate";
import { DateMoveImpactDialog } from "@/components/projects/date-move-impact-dialog";
import { CoachingTip } from "@/components/onboarding/coaching-tip";
import { useActivationMilestones } from "@/hooks/use-activation-milestones";
import { activeMilestoneKey } from "@/lib/activation-milestones";
import { PROJECT_TYPE_LABELS } from "@/lib/project-type-labels";
import { resolveWindowMs } from "@/lib/project-form-dates";
import {
  ProjectFields, projectFormDefaults, useProjectFieldsState,
  type EditableProject, type ProjectFieldsSection,
} from "@/components/projects/project-fields";

export type { EditableProject };

type StepKey = "basics" | "schedule" | "site" | "review";
const STEPS: { key: StepKey; label: string; tip: string; sections: ProjectFieldsSection[]; fields: (keyof ProjectFormValues)[] }[] = [
  { key: "basics", label: "Basics", tip: "Name it, aim it at a client, and you're rolling — tighten the rest as the gig firms up.", sections: ["job", "money"], fields: ["name", "projectNumber", "clientId", "clientContactId", "type", "description", "tags"] },
  { key: "schedule", label: "Schedule", tip: "Rough dates are fine. You can tighten the job window later.", sections: ["schedule"], fields: ["rentalStartDate", "rentalEndDate", "projectStartDate", "projectStartTime", "projectEndDate", "projectEndTime"] },
  { key: "site", label: "Site", tip: "Where it's happening and who to call on the day. All optional.", sections: ["where"], fields: ["locationId", "siteContactName", "siteContactPhone", "siteContactEmail"] },
  { key: "review", label: "Review", tip: "Looks right? Create the job and start adding gear.", sections: [], fields: [] },
];

/** Split out purely to keep `onSuccess`'s own complexity under the ceiling
 *  (D3, #1107's hand-off branch pushed it over). */
function projectSavedToastCopy(isEditing: boolean, isTemplate: boolean): string {
  if (isEditing) return isTemplate ? "Template updated" : "Job updated";
  return isTemplate ? "Template created" : "Job created";
}

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
  // D3 (#1107) — reads the FULL milestone state because the hand-off needs
  // firstModelId/firstModelName too, to deep-link + label "Add <model> to it".
  const activationState = useActivationMilestones(orgId);
  const isActiveProjectMilestone =
    activationState != null && activeMilestoneKey(activationState) === "project";

  const isEditing = !!project;
  const isTemplate = isTemplateProp ?? project?.isTemplate ?? false;

  const [step, setStep] = useState(0);

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

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: projectFormDefaults(project),
  });
  const state = useProjectFieldsState({ form, project, orgId, isTemplate });
  const { managerIds, initialManagerIds } = state;

  const v = form.watch();

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
            new Error(`Job code "${data.projectNumber.trim()}" is already in use.`),
            { field: "projectNumber" as const },
          );
        }
      }

      const result = project
        ? await projectWrites.update(project.id, data, isTemplate, form.formState.defaultValues as ProjectFormValues)
        : await projectWrites.create({ ...data, isTemplate });

      // Reconcile managers to the full selected set in one call — the server
      // diffs against the current rows. Only call when the set actually changed:
      // setProjectManagers needs project:manage, and an unchanged save must stay a
      // pure create/update (a non-owner without manage permission would otherwise
      // fail on a manager no-op).
      const managersChanged =
        managerIds.length !== initialManagerIds.length ||
        managerIds.some((id) => !initialManagerIds.includes(id));
      if (managersChanged) {
        await managerWrites.set(result.id, managerIds);
      }
      return result;
    },
    onSuccess: (result) => {
      // D3 (#1107) — offered, never forced. Templates never complete the
      // "project" milestone, so they never offer this hand-off either.
      const firstModelId = activationState?.firstModelId;
      const offerHandoff = !isEditing && !isTemplate && isActiveProjectMilestone && !!firstModelId;
      if (offerHandoff) {
        toast.success("Job created", {
          action: {
            label: `Add ${activationState?.firstModelName ?? "it"} to it`,
            onClick: () => router.push(`/projects/${result.id}?tab=equipment&modelId=${firstModelId}`),
          },
        });
      } else {
        toast.success(projectSavedToastCopy(isEditing, isTemplate));
      }
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

  // #1227 — non-blocking preview: does moving THIS project's dates strand
  // another job's gear? Only meaningful in edit mode.
  const dateMoveGate = useDateMoveGate<ProjectFormValues>(
    orgId,
    project?.id ?? "",
    project?.status ?? undefined,
    project ? resolveWindowMs(project) : { start: null, end: null },
    (data) => mutation.mutate(data),
  );

  const next = async () => {
    const ok = await form.trigger(STEPS[step].fields);
    // Project code is required (schema allows blank for auto-gen, so enforce here).
    if (step === 0 && !isTemplate && !form.getValues("projectNumber")?.trim()) {
      form.setError("projectNumber", { type: "manual", message: "Job code is required." });
      return;
    }
    if (ok) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  // Prefer the getById-resolved name (the selected client may be off the current
  // bounded search page — e.g. editing an older project or after another search).
  const clientName = state.selectedClientName ?? state.clientOptions.find((c) => c.value === v.clientId)?.label;
  const locationName = state.locationOptions.find((l) => l.value === v.locationId)?.label;
  const typeName = v.type ? PROJECT_TYPE_LABELS[v.type] : undefined;

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
                  done ? "bg-primary text-white" : active ? "border-2 border-red text-red-text" : "border-2 border-line text-muted",
                )}>
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className={cn("text-table-cell font-medium", active ? "text-ink" : done ? "text-ink-2" : "text-muted")}>{s.label}</span>
              </button>
              {i < STEPS.length - 1 && <span className={cn("h-px flex-1", done ? "bg-red" : "bg-line")} />}
            </li>
          );
        })}
      </ol>

      <form
        onSubmit={form.handleSubmit((d) => {
          if (isEditing) {
            void dateMoveGate.requestSave(resolveWindowMs(d), d);
          } else {
            mutation.mutate(d);
          }
        })}
        className="mt-6 grid gap-6 lg:grid-cols-[1fr_280px]"
      >
        {/* Step content */}
        <div className="rounded-[var(--r-lg)] border border-line bg-card p-5 shadow-[var(--sh-card)] sm:p-6">
          <h2
            ref={stepHeadingRef}
            tabIndex={-1}
            className={cn("t-overline mb-4 rounded-[var(--r)] text-muted", focusRing)}
          >
            Step {step + 1}: {STEPS[step].label}
          </h2>

          {step < 3 && <ProjectFields key={STEPS[step].key} form={form} state={state} sections={STEPS[step].sections} />}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="font-display text-section-header font-bold text-ink">{v.name || "Untitled job"}</h2>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <ReviewRow label="Client" value={clientName} />
                <ReviewRow label="Contact" value={state.contactOptions.find((c) => c.value === v.clientContactId)?.label} />
                <ReviewRow label="Type" value={typeName} />
                <ReviewRow label="Managers" value={managerIds.length ? `${managerIds.length} assigned` : undefined} />
                <ReviewRow label="Job code" value={v.projectNumber || (state.nextProjectNumber ? `Auto: ${state.nextProjectNumber}` : undefined)} mono />
                <ReviewRow label="Rental" value={dateRange(v.rentalStartDate, v.rentalEndDate)} />
                <ReviewRow label="Job window" value={dateRange(v.projectStartDate, v.projectEndDate) || "Same as rental"} />
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
              <Button type="submit" variant="halo" disabled={mutation.isPending || dateMoveGate.checking}>
                {mutation.isPending || dateMoveGate.checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {isEditing ? "Save changes" : isTemplate ? "Create template" : "Create job"}
              </Button>
            )}
          </div>
        </div>

        <DateMoveImpactDialog
          open={!!dateMoveGate.pending}
          rows={dateMoveGate.pending?.rows ?? []}
          pending={mutation.isPending}
          onConfirm={dateMoveGate.confirmPending}
          onCancel={dateMoveGate.cancelPending}
        />

        {/* Helper rail */}
        <aside className="hidden lg:block">
          <div className="sticky top-4 space-y-4 rounded-[var(--r-lg)] border border-line bg-paper-2/50 p-4">
            {step === 0 ? (
              <CoachingTip
                orgId={orgId}
                milestoneKey="project"
                fallbackEyebrow={`Step ${step + 1} of ${STEPS.length}`}
                fallbackTip={STEPS[step].tip}
              />
            ) : (
              <div>
                <p className="t-overline text-muted">Step {step + 1} of {STEPS.length}</p>
                <p className="mt-1 font-hand text-[15px] text-t-out">{STEPS[step].tip}</p>
              </div>
            )}
            <div className="space-y-2 border-t border-line pt-3">
              <p className="t-overline text-muted">So far</p>
              <SummaryLine label="Name" value={v.name || "—"} />
              <SummaryLine label="Client" value={clientName || "—"} />
              <SummaryLine label="Type" value={typeName || "—"} />
              <SummaryLine label="Dates" value={dateRange(v.rentalStartDate, v.rentalEndDate) || "—"} />
            </div>
          </div>
        </aside>
      </form>
    </>
  );
}

function ReviewRow({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line pb-2">
      <dt className="t-micro text-muted">{label}</dt>
      <dd className={cn("text-ui-text", value ? "text-ink" : "text-muted", mono && "font-mono text-caption")}>{value || "Not set"}</dd>
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
