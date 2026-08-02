"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ConvexError } from "convex/values";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQuoteWrites } from "@/hooks/use-quote-writes";
import { formatDate } from "@/lib/formatters";

/**
 * #1080/#1100 (Phase 5) — the lock strip's second exit from a `QUOTE_SENT`
 * lock: "Recall vN to edit" alongside the existing "Create v(N+1)". Refines
 * decision 5 (design doc §2.7) — a bare auto-recall on first edit can't be
 * implemented as stated (a SENT quote already raises the project to
 * FINANCE_LOCKED before any auto-recall could fire), so the lock learns this
 * one-click confirm instead of a bare toast.
 *
 * Calls the EXISTING `recallNative` unchanged (out of scope: any change to
 * recall itself) — this is decision 5's behaviour with one confirmation in
 * front of it, not a second recall path. The reason text is a fixed string
 * rather than a free-text field: the whole point is "one click", and every
 * other un-send path already requires an explicit reason — this dialog IS
 * that explicit act.
 */

const RECALL_TO_EDIT_REASON = "Recalled to edit from the project's lock strip.";

export interface RecallToEditLiveQuote {
  id: string;
  version: number;
  sentAt?: number | null;
  protected?: boolean;
}

interface RecallToEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The live quote a QUOTE_SENT lock is describing. Null renders nothing —
   *  defensive only, since the strip never opens this without one in hand. */
  liveQuote: RecallToEditLiveQuote | null;
  /** The allocator + 1 — what `newVersionNative` actually allocates,
   *  regardless of which revision is live (#1080/#1085). */
  nextVersion: number;
  onCreateNextVersion: () => void;
  creatingNextVersion?: boolean;
}

function quoteProtectedError(e: unknown): boolean {
  return (
    e instanceof ConvexError &&
    !!e.data &&
    typeof e.data === "object" &&
    (e.data as { code?: unknown }).code === "QUOTE_PROTECTED"
  );
}

/** The recall attempt itself, split out purely to keep the component's own
 *  line count down (R-3.6) — returns an outcome rather than throwing, so the
 *  component only ever has to route it to a toast/state update. */
type RecallOutcome = { kind: "success"; toastMessage: string } | { kind: "protectedRace" } | { kind: "error"; message: string };

async function runRecall(
  recall: (id: string, data: { reason: string }) => Promise<{ restoredQuoteId: string | null }>,
  liveQuote: RecallToEditLiveQuote,
): Promise<RecallOutcome> {
  try {
    const result = await recall(liveQuote.id, { reason: RECALL_TO_EDIT_REASON });
    return {
      kind: "success",
      toastMessage: result.restoredQuoteId
        ? `Recalled v${liveQuote.version} — the previous revision is the client's current quote again`
        : `Recalled v${liveQuote.version} — it's a draft again`,
    };
  } catch (e) {
    if (quoteProtectedError(e)) return { kind: "protectedRace" };
    return { kind: "error", message: e instanceof Error ? e.message : "Failed to recall" };
  }
}

/** Split out purely to keep `RecallToEditDialog`'s own line count down
 *  (R-3.6) — the protected/unprotected branch each has its own title +
 *  explanation (design §2.7), never a raw `QUOTE_PROTECTED` error. */
function recallDialogCopy(version: number, isProtected: boolean, sentPhrase: string): { title: string; description: string } {
  if (isProtected) {
    return {
      title: `v${version} is protected`,
      description: `v${version} was accepted${sentPhrase} and is protected. An owner must unprotect it before it can be edited.`,
    };
  }
  return {
    title: `Edit v${version}?`,
    description: `v${version} was sent to the client${sentPhrase}. Editing it recalls the quote — the PDF they're holding will no longer match v${version}. The old document is kept in the audit trail.`,
  };
}

export function RecallToEditDialog({
  open,
  onOpenChange,
  liveQuote,
  nextVersion,
  onCreateNextVersion,
  creatingNextVersion,
}: RecallToEditDialogProps) {
  const quoteWrites = useQuoteWrites();
  const [pending, setPending] = useState(false);
  // Belt-and-braces: a race (someone else protects the quote between the
  // strip rendering and this dialog's confirm click) surfaces the SAME
  // un-protect explanation rather than a raw QUOTE_PROTECTED toast — never
  // just re-showing the button that just failed.
  const [raceProtected, setRaceProtected] = useState(false);

  if (!liveQuote) return null;
  const quote = liveQuote;
  const isProtected = quote.protected || raceProtected;
  const sentPhrase = quote.sentAt != null ? ` on ${formatDate(new Date(quote.sentAt))}` : "";

  async function confirmRecall() {
    setPending(true);
    const outcome = await runRecall(quoteWrites.recall, quote);
    setPending(false);
    if (outcome.kind === "protectedRace") return setRaceProtected(true);
    if (outcome.kind === "error") return toast.error(outcome.message);
    toast.success(outcome.toastMessage);
    onOpenChange(false);
  }

  function createNextVersion() {
    onCreateNextVersion();
    onOpenChange(false);
  }

  const { title, description } = recallDialogCopy(quote.version, isProtected, sentPhrase);

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="line" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" variant="line" loading={creatingNextVersion} disabled={pending} onClick={createNextVersion}>
            Create v{nextVersion} instead
          </Button>
          {!isProtected && (
            <Button type="button" loading={pending} onClick={() => void confirmRecall()}>
              Recall v{quote.version} and edit
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
