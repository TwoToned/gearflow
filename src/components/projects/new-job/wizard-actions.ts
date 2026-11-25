import { toast } from "sonner";
import type { UseFormReturn } from "react-hook-form";
import { activeMilestoneKey, type ActivationMilestonesState } from "@/lib/activation-milestones";
import { projectFormDefaults } from "@/components/projects/project-fields";
import type { ProjectFormValues } from "@/lib/validations/project";
import type { StartStatus } from "./step-review";

/**
 * What the wizard's header and footer DO, kept out of the component so each verb
 * is small and testable. The draft row is the one source: Create finishes it,
 * Discard removes it, nothing here ever duplicates it. Removal is ONE server
 * verb (`discardDraft`): it deletes only an empty draft the caller made and
 * nobody else touched, and otherwise cancels while still an Enquiry. There is no
 * client-side "archive then delete", and no snapshot-recreate Undo.
 */
interface Writes {
  discardDraft: (projectId: string, createAuditId: string, via: "undo" | "discard") => Promise<{ outcome: "deleted" | "cancelled" }>;
}

export interface WizardContext {
  form: UseFormReturn<ProjectFormValues>;
  writes: Writes;
  push: (href: string) => void;
  draftId: string | undefined;
  draftNumber: string | undefined;
  createAuditId: () => string;
  flush: () => Promise<string | undefined>;
  forget: () => void;
  /** Validates step one, writes the draft, and returns its id. */
  finishStepOne: () => Promise<string | undefined>;
  updateStatus: (id: string, status: StartStatus) => Promise<void>;
  startsAs: StartStatus;
  milestones: ActivationMilestonesState | undefined;
  lineCount: number;
  resetWizard: () => void;
}

export async function discardDraft(ctx: WizardContext) {
  if (ctx.draftId) {
    try {
      const { outcome } = await ctx.writes.discardDraft(ctx.draftId, ctx.createAuditId(), "discard");
      toast.success(outcome === "deleted" ? "Draft discarded" : "Draft cancelled");
    } catch (e) {
      return void toast.error((e as Error).message);
    }
  }
  ctx.forget();
  ctx.form.reset(projectFormDefaults());
  ctx.resetWizard();
}

function enquiryToast(ctx: WizardContext, id: string) {
  const label = `Enquiry${ctx.draftNumber ? ` ${ctx.draftNumber}` : ""} created`;
  const auditId = ctx.createAuditId();
  toast.success(label, {
    // The server decides: it refuses once anyone has worked on the job, after the window, or twice.
    action: {
      label: "Undo",
      onClick: async () => {
        try {
          await ctx.writes.discardDraft(id, auditId, "undo");
          toast.success("Enquiry removed");
          ctx.push("/projects");
        } catch (e) {
          toast.error((e as Error).message);
        }
      },
    },
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
