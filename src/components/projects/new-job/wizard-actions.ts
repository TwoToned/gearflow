import { toast } from "sonner";
import type { UseFormReturn } from "react-hook-form";
import { activeMilestoneKey, type ActivationMilestonesState } from "@/lib/activation-milestones";
import { projectFormDefaults } from "@/components/projects/project-fields";
import type { ProjectFormValues } from "@/lib/validations/project";
import type { StartStatus } from "./step-review";

/**
 * What the wizard's header and footer DO, kept out of the component so each verb
 * is small and testable. The draft row is the one source: Create finishes it,
 * Discard removes it, nothing here ever duplicates it.
 */
interface Writes {
  archive: (id: string) => Promise<void>;
  remove: (id: string) => Promise<unknown>;
}

export interface WizardContext {
  form: UseFormReturn<ProjectFormValues>;
  writes: Writes;
  canDelete: boolean;
  push: (href: string) => void;
  draftId: string | undefined;
  draftNumber: string | undefined;
  lineCount: number;
  flush: () => Promise<string | undefined>;
  forget: () => void;
  /** Validates step one, writes the draft, and returns its id. */
  finishStepOne: () => Promise<string | undefined>;
  updateStatus: (id: string, status: StartStatus) => Promise<void>;
  startsAs: StartStatus;
  milestones: ActivationMilestonesState | undefined;
  resetWizard: () => void;
}

/** Cancel the draft, and delete it when the member may. The one removal path (Discard and the enquiry's Undo). */
async function removeDraft(ctx: Pick<WizardContext, "writes" | "canDelete">, id: string) {
  await ctx.writes.archive(id);
  if (ctx.canDelete) await ctx.writes.remove(id);
}

export async function discardDraft(ctx: WizardContext) {
  const snapshot = ctx.form.getValues();
  if (ctx.draftId) await removeDraft(ctx, ctx.draftId);
  ctx.forget();
  ctx.form.reset(projectFormDefaults());
  ctx.resetWizard();
  // Undo only for a lineless draft: it is exactly the form's own values; lines can't be restored.
  const undo = { action: { label: "Undo", onClick: () => { ctx.form.reset(snapshot); void ctx.flush(); } } };
  toast.success("Draft discarded", ctx.lineCount === 0 ? undo : undefined);
}

function enquiryToast(ctx: WizardContext, id: string) {
  const label = `Enquiry${ctx.draftNumber ? ` ${ctx.draftNumber}` : ""} created`;
  toast.success(label, {
    action: { label: "Undo", onClick: async () => { await removeDraft(ctx, id); ctx.push("/projects"); } },
  });
}

/** The activation hand-off (#1107), offered only when the job has no gear yet. */
function createdToast(ctx: WizardContext, id: string) {
  const m = ctx.milestones;
  const active = !!m && ctx.lineCount === 0 && activeMilestoneKey(m) === "project";
  if (!active || !m?.firstModelId) return void toast.success("Job created");
  const modelId = m.firstModelId;
  toast.success("Job created", {
    action: { label: `Add ${m.firstModelName ?? "it"} to it`, onClick: () => ctx.push(`/projects/${id}?tab=equipment&modelId=${modelId}`) },
  });
}

/** `Create as enquiry` (from step one) and `Create job` (review): both finish the draft row. */
export async function createJob(ctx: WizardContext, asEnquiry: boolean): Promise<boolean> {
  const id = asEnquiry ? await ctx.finishStepOne() : await ctx.flush();
  if (!id) return false;
  if (asEnquiry) enquiryToast(ctx, id);
  else {
    if (ctx.startsAs !== "ENQUIRY") await ctx.updateStatus(id, ctx.startsAs);
    createdToast(ctx, id);
  }
  ctx.push(`/projects/${id}`);
  return true;
}
