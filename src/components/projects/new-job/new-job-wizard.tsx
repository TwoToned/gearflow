"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ActionMenu } from "@/components/ui/action-menu";
import { PinnedAboveBottomNav } from "@/components/ui/bulk-bar";
import { useIsMobile } from "@/hooks/use-mobile";
import { useActiveOrganization } from "@/lib/auth-client";
import { useProject } from "@/hooks/use-projects";
import { useProjectWrites, useNativeProjectStatus } from "@/hooks/use-native-project-writes";
import { useActivationMilestones } from "@/hooks/use-activation-milestones";
import { projectSchema, type ProjectFormValues } from "@/lib/validations/project";
import { cn, focusRing } from "@/lib/utils";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import {
  ProjectFields, projectFormDefaults, useProjectFieldsState,
} from "@/components/projects/project-fields";
import { useJobDraft } from "./use-job-draft";
import { StartFromTemplate, useTemplateApply } from "./start-from-template";
import { AvailabilityLine, useWizardAvailability } from "./availability-line";
import { StepWhat, useWizardLines } from "./step-what";
import { StepReview, type StartStatus } from "./step-review";
import { createJob, discardDraft, type WizardContext } from "./wizard-actions";

/**
 * `/projects/new` (UX Phase 9, spec 7c): three steps as words, Who and when ·
 * What n · Review. The job row is a real draft Enquiry from the first valid name
 * (`useJobDraft`), so a dropped connection loses nothing, the What step is the
 * Equipment tab's own add pointed at the draft, and `Create job` finishes the same
 * row. Fields are the shared `ProjectFields`; status is not one of them.
 */
type StepKey = "who" | "what" | "review";
const STEP_FIELDS: (keyof ProjectFormValues)[] = ["name", "clientId", "clientContactId", "type", "description", "tags", "rentalStartDate", "rentalEndDate", "projectStartDate", "projectEndDate", "locationId", "siteContactEmail"];

export function NewJobWizard() {
  const { data: activeOrg } = useActiveOrganization();
  // Keyed by org: an org switch resets the wizard (the open draft is left, not deleted).
  return <WizardBody key={activeOrg?.id ?? "none"} orgId={activeOrg?.id} />;
}

/** `/projects/new?clientId=` (the client page's New job) pre-picks the client, once. */
function useClientParam(form: UseFormReturn<ProjectFormValues>) {
  const clientParam = useSearchParams().get("clientId");
  const applied = useRef(false);
  useEffect(() => {
    if (clientParam && !applied.current) {
      applied.current = true;
      form.setValue("clientId", clientParam);
    }
  }, [clientParam, form]);
}

/** `/projects/new?template=<id>` (the manager's `Use for a new job`) is the same pick as the menu, once. */
function useTemplateParam(pick: (t: { id: string }) => void) {
  const id = useSearchParams().get("template");
  const applied = useRef(false);
  useEffect(() => {
    if (id && !applied.current) {
      applied.current = true;
      pick({ id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
}

/** Focus is never silently lost on a step change (R-8.1.7): land on the new step's heading. */
function useStepFocus(step: StepKey) {
  const ref = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    ref.current?.focus();
  }, [step]);
  return ref;
}

function WizardBody({ orgId }: { orgId: string | undefined }) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const writes = useProjectWrites(orgId);
  const status = useNativeProjectStatus(orgId);
  const milestones = useActivationMilestones(orgId);

  const [step, setStep] = useState<StepKey>("who");
  const [unlocked, setUnlocked] = useState(false);
  const [startsAs, setStartsAs] = useState<StartStatus>("ENQUIRY");
  const [creating, setCreating] = useState(false);

  const form = useForm<ProjectFormValues>({ resolver: zodResolver(projectSchema), defaultValues: projectFormDefaults() });
  const state = useProjectFieldsState({ form, orgId, isTemplate: false, prefillCode: false });
  const draft = useJobDraft({ form, orgId, managerIds: state.managerIds });
  const v = form.watch();
  const doc = useProject(draft.draftId);
  const data = useWizardLines(draft.draftId, orgId);
  const [month, setMonth] = useState<Date | undefined>();
  const avail = useWizardAvailability(orgId, draft.draftId, v.rentalStartDate as string | undefined, v.rentalEndDate as string | undefined, month);
  const shortLines = data.lines.filter((l) => (data.overbooked[l.id]?.overBy ?? 0) > 0).length;
  useClientParam(form);
  const tpl = useTemplateApply(draft.draftId, draft.adopt, draft.flush);
  useTemplateParam(tpl.pick);
  const headingRef = useStepFocus(step);

  /** Step one must validate; the code is required when the org types its own. */
  const finishStepOne = async (): Promise<string | undefined> => {
    if (!(await form.trigger(STEP_FIELDS))) return undefined;
    const id = await draft.flush();
    if (!id && !form.getValues("projectNumber")?.trim()) {
      form.setError("projectNumber", { type: "manual", message: "Job code is required." });
      return undefined;
    }
    setUnlocked(true);
    return id;
  };

  const ctx: WizardContext = {
    form, writes, push: router.push, draftId: draft.draftId, draftNumber: draft.number, createAuditId: draft.createAuditId, lineCount: data.lines.length,
    flush: draft.flush, forget: draft.forget, finishStepOne, updateStatus: status.updateStatus, startsAs, milestones,
    resetWizard: () => { setUnlocked(false); setStep("who"); },
  };
  const run = async (task: () => Promise<unknown>) => {
    setCreating(true);
    try { await task(); } catch (e) { toast.error((e as Error).message); } finally { setCreating(false); }
  };

  const advancing = useRef(false);
  const next = async () => {
    if (step === "review") return void run(() => createJob(ctx, false));
    if (step === "what") return setStep("review");
    // Step one writes the draft (async): a second press while it is in flight is the same step, not the next.
    if (advancing.current) return;
    advancing.current = true;
    try {
      if (await finishStepOne()) setStep("what");
    } finally {
      advancing.current = false;
    }
  };
  const back = () => setStep(step === "review" ? "what" : "who");

  const named = !!v.name?.trim();
  const menu = headMenu(draft.draftId ? () => discardDraft(ctx) : undefined, data.lines.length);
  const actions = (
    <WizardActions
      step={step} creating={creating} named={named}
      onEnquiry={() => void run(() => createJob(ctx, true))} onBack={back} onNext={() => void next()}
    />
  );
  const whoStep = (
    <WhoStep
      form={form} state={state} onSubmit={() => void next()}
      templateSlot={<StartFromTemplate orgId={orgId} picked={tpl.picked} onPick={tpl.pick} onScratch={tpl.scratch} />}
      availability={{ busyDays: avail.busyDays, onMonthChange: setMonth, footer: <AvailabilityLine hasDates={!!v.rentalStartDate} others={avail.others} shortLines={shortLines} lineCount={data.lines.length} /> }}
    />
  );
  const reviewStep = (
    <StepReview
      values={v} data={data} number={draft.number} others={avail.others}
      clientName={state.selectedClientName} locationName={state.locationOptions.find((l) => l.value === v.locationId)?.label}
      managerCount={state.managerIds.length} discountAmount={Number(doc?.discountAmount) || 0}
      startsAs={startsAs} onStartsAs={setStartsAs} onEdit={setStep}
    />
  );
  const bodies: Record<StepKey, React.ReactNode> = {
    who: whoStep,
    what: <StepWhat draftId={draft.draftId} orgId={orgId} data={data} />,
    review: reviewStep,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-24 md:pb-0">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="t-page-title text-ink">New job</h1>
          <p className="t-micro text-muted" role="status">{draftStatusLine(draft.phase, draft.number, named)}</p>
        </div>
        {!isMobile && actions}
        {menu && <ActionMenu spec={menu} label="Wizard actions" />}
      </header>

      <StepNav step={step} unlocked={unlocked} whatCount={data.lines.length} onPick={setStep} />

      <h2 ref={headingRef} tabIndex={-1} className="sr-only">{STEP_TITLES[step]}</h2>

      {bodies[step]}

      {isMobile && <PinnedAboveBottomNav><div className="flex items-center justify-between rounded-[var(--r-lg)] border border-line bg-elev px-3 py-2">{actions}</div></PinnedAboveBottomNav>}
    </div>
  );
}

const STEP_TITLES: Record<StepKey, string> = { who: "Who and when", what: "What", review: "Review" };

function StepNav({ step, unlocked, whatCount, onPick }: { step: StepKey; unlocked: boolean; whatCount: number; onPick: (s: StepKey) => void }) {
  const words: [StepKey, string][] = [["who", "Who and when"], ["what", `What ${whatCount}`], ["review", "Review"]];
  return (
    <nav aria-label="Steps" className="flex gap-5 overflow-x-auto border-b border-line">
      {words.map(([key, label]) => (
        <button
          key={key}
          type="button"
          disabled={key !== "who" && !unlocked}
          aria-current={step === key ? "step" : undefined}
          onClick={() => onPick(key)}
          className={cn("min-h-11 shrink-0 border-b-2 px-0.5 text-table-cell disabled:opacity-45 md:min-h-9", step === key ? "border-red font-semibold text-ink" : "border-transparent text-ink-2", focusRing)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

/** Step one: the shared fields, with the dates-and-availability line under the calendar and the rest folded. */
function WhoStep({
  form, state, availability, onSubmit, templateSlot,
}: {
  form: UseFormReturn<ProjectFormValues>;
  state: ReturnType<typeof useProjectFieldsState>;
  availability: { busyDays?: ReadonlyMap<string, string>; footer: React.ReactNode; onMonthChange: (month: Date) => void };
  onSubmit: () => void;
  templateSlot: React.ReactNode;
}) {
  const [more, setMore] = useState(false);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="space-y-8">
      <div>{templateSlot}</div>
      <ProjectFields form={form} state={state} sections={["job", "schedule"]} schedule={availability} />
      <section>
        <button type="button" aria-expanded={more} onClick={() => setMore((m) => !m)} className={cn("flex min-h-11 items-center gap-1 text-table-cell text-ink-2", focusRing)}>
          Site, location and discount <ChevronDown className={cn("size-4 transition-transform", more && "rotate-180")} />
        </button>
        {more && <div className="mt-3"><ProjectFields form={form} state={state} sections={["where", "money"]} /></div>}
      </section>
    </form>
  );
}

/** The primary pair: `Create as enquiry | Next` on step one, `Back | Next`, then `Back | Create job`. */
function WizardActions({
  step, creating, named, onEnquiry, onBack, onNext,
}: { step: StepKey; creating: boolean; named: boolean; onEnquiry: () => void; onBack: () => void; onNext: () => void }) {
  return (
    <div className="flex items-center gap-3">
      {step === "who" ? (
        <TextButton disabled={creating || !named} onClick={onEnquiry}>Create as enquiry</TextButton>
      ) : (
        <TextButton onClick={onBack}>Back</TextButton>
      )}
      <Button type="button" variant="primary" disabled={creating} onClick={onNext} className="min-h-11 md:min-h-9">
        {step === "review" ? "Create job" : "Next"}
      </Button>
    </div>
  );
}

function TextButton({ children, ...rest }: React.ComponentProps<"button">) {
  return (
    <button type="button" {...rest} className={cn("min-h-11 px-1 text-table-cell text-ink-2 underline-offset-4 hover:underline disabled:opacity-45 md:min-h-0", focusRing)}>
      {children}
    </button>
  );
}

function draftStatusLine(phase: string, number: string | undefined, named: boolean): string {
  if (phase === "error") return "Couldn't save the draft. It retries on your next change.";
  if (phase === "saving") return "Saving…";
  if (phase === "saved" && number) return `✓ Draft ${number} saved`;
  return named ? "Draft starts once the job code is set" : "Draft starts when you name the job";
}

/** The page ⋯: sibling links first, `Discard draft…` red and last (its confirm names what goes). */
function headMenu(discard: (() => Promise<void>) | undefined, lineCount: number): ActionMenuSpec | null {
  if (!discard) return null;
  return {
    items: [{
      key: "discard", label: "Discard draft…", group: "danger", danger: true, onSelect: discard,
      confirm: {
        title: "Discard this draft?",
        body: lineCount > 0
          ? `The draft already has ${lineCount} line${lineCount === 1 ? "" : "s"}, so it is cancelled rather than deleted: it stays in Jobs as Cancelled. This can't be undone.`
          : "The empty draft is removed. This can't be undone.",
        confirmLabel: "Discard draft",
      },
    }],
  };
}
