"use client";

import { useState } from "react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useStableNow } from "@/hooks/use-stable-now";
import { useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../../convex/_generated/api";
import { useClientTimelineWrites } from "@/hooks/use-client-timeline-writes";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CalendarClock, CircleCheck } from "lucide-react";
import { intentStyles } from "@/lib/status-colors";
import { cn } from "@/lib/utils";

type NextStep = { id: string; title: string; dueDate: number | null; description: string | null; projectId: string | null };

function toDateInputValue(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The left-hand icon + status text — split out of `NextStepBanner` (R-3.6)
 *  purely to keep that component's own complexity down. */
function NextStepSummary({ nextStep, requiresNextStep }: { nextStep: NextStep | null; requiresNextStep: boolean }) {
  const overdue = !!nextStep?.dueDate && nextStep.dueDate < Date.now();
  const tone = nextStep ? "info" : requiresNextStep ? "error" : "neutral";
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", intentStyles[tone].bg)}>
        <CalendarClock className={cn("h-4 w-4", intentStyles[tone].text)} />
      </span>
      <div className="min-w-0">
        <p className="t-overline text-muted">Next step</p>
        {nextStep ? (
          <>
            <p className="truncate text-ui-text font-medium text-ink">{nextStep.title}</p>
            {nextStep.dueDate != null && (
              <p className={cn("text-caption", overdue ? "text-t-out" : "text-muted")}>
                Due {new Date(nextStep.dueDate).toLocaleDateString()}
                {overdue ? " — overdue" : ""}
              </p>
            )}
          </>
        ) : (
          <p className="text-ui-text text-ink-2">
            {requiresNextStep ? "None set — this client has a quote out." : "No next step set"}
          </p>
        )}
      </div>
    </div>
  );
}

function CompleteNextStepDialog({ nextStep, onComplete }: { nextStep: NextStep; onComplete: (outcome: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState("");
  const mutation = useServerMutation({
    mutationFn: () => onComplete(outcome.trim()),
    onSuccess: () => {
      toast.success("Next step completed");
      setOpen(false);
      setOutcome("");
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="line" size="sm">
          <CircleCheck className="h-4 w-4" />
          Complete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Complete next step</DialogTitle>
          <DialogDescription>What happened for &quot;{nextStep.title}&quot;? One line is enough.</DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          placeholder="e.g. Spoke with Sarah — she'll confirm by Friday."
          rows={3}
        />
        <DialogFooter>
          <Button onClick={() => mutation.mutate()} disabled={!outcome.trim() || mutation.isPending}>
            Complete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SetNextStepDialog({
  variant,
  onSet,
}: {
  variant: "line" | "primary";
  onSet: (data: { title: string; dueDate: number; notes?: string }) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const mutation = useServerMutation({
    mutationFn: () => onSet({ title: title.trim(), dueDate: new Date(dueDate).getTime(), notes: notes.trim() || undefined }),
    onSuccess: () => {
      toast.success("Next step set");
      setOpen(false);
      setTitle("");
      setDueDate("");
      setNotes("");
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size="sm">
          <CalendarClock className="h-4 w-4" />
          Set next step
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set next step</DialogTitle>
          <DialogDescription>A dated follow-up for this client.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="next-step-title">Title</Label>
            <Input id="next-step-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Call to confirm budget" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="next-step-due">Due date</Label>
            <Input id="next-step-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} min={toDateInputValue(Date.now())} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="next-step-notes">Notes (optional)</Label>
            <Textarea id="next-step-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => mutation.mutate()} disabled={!title.trim() || !dueDate || mutation.isPending}>
            Set next step
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Next step — pinned above the client page's tabs (#1245, design §8.4): "the
 * single open follow_up with the soonest date. Rule: while any quote for
 * this client is SENT (via effectiveQuoteStatus), a next step is required."
 * Completing one asks for a one-line outcome, which becomes a timeline row.
 */
export function NextStepBanner({ clientId }: { clientId: string }) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const writes = useClientTimelineWrites();

  // Mount-time snapshot — a fresh `Date.now()` here re-keys the subscription on
  // every render, so `data` stayed `undefined` and the banner never rendered
  // (see src/hooks/use-stable-now.ts).
  const now = useStableNow();
  const data = useAuthedQuery(api.clientTimeline.nextStep, orgId ? { orgId, clientId, now } : "skip");

  if (data === undefined) return null;
  const { nextStep, requiresNextStep } = data;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-[var(--r-lg)] border-2 p-4 sm:flex-row sm:items-center sm:justify-between",
        !nextStep && requiresNextStep ? "border-t-out/40 bg-out-soft/40" : "border-line bg-card",
      )}
    >
      <NextStepSummary nextStep={nextStep} requiresNextStep={requiresNextStep} />
      <div className="flex shrink-0 items-center gap-2">
        {nextStep && <CompleteNextStepDialog nextStep={nextStep} onComplete={(outcome) => writes.completeNextStep(nextStep.id, outcome)} />}
        <SetNextStepDialog
          variant={nextStep ? "line" : "primary"}
          onSet={(stepData) => writes.setNextStep(clientId, stepData)}
        />
      </div>
    </div>
  );
}
