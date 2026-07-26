"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Unlock } from "lucide-react";
import { toast } from "sonner";
import { useUnlockSession } from "@/hooks/use-project-lock";

/**
 * Persistent banner while an unlock session is open (#791/#792): "Financials
 * unlocked by {name} — '{justification}'" + Save & relock / Discard. Discard
 * restores the pre-unlock snapshot (money-only for FINANCIAL scope, structure
 * + money for FULL) and reports any conflicts the restore couldn't safely
 * auto-resolve (warehouse-backed entities — see convex/lib/projectSnapshots.ts).
 */
interface UnlockSessionBannerProps {
  projectId: string;
  orgId: string;
  session: {
    scope: "FINANCIAL" | "FULL";
    justification: string;
    openedByName?: string;
  };
}

export function UnlockSessionBanner({ projectId, orgId, session }: UnlockSessionBannerProps) {
  const { commit, discard } = useUnlockSession(projectId, orgId);
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  const handleCommit = async () => {
    setPending(true);
    try {
      await commit();
      toast.success("Saved & relocked");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save & relock");
    } finally {
      setPending(false);
    }
  };

  const handleDiscard = async () => {
    setPending(true);
    try {
      const { conflicts } = await discard();
      setDiscardOpen(false);
      if (conflicts.length > 0) {
        toast.warning(`Discarded — ${conflicts.length} item(s) need manual review`, {
          description: conflicts.join(" "),
        });
      } else {
        toast.success("Changes discarded");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to discard changes");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border-2 border-warn bg-warn-soft px-4 py-3">
        <Unlock className="h-4 w-4 shrink-0 text-warn" />
        <p className="flex-1 min-w-0 text-sm text-ink">
          <span className="font-semibold">
            {session.scope === "FULL" ? "Full unlock" : "Financials unlocked"}
            {session.openedByName ? ` by ${session.openedByName}` : ""}
          </span>
          {" — “"}{session.justification}{"”"}
        </p>
        <div className="flex gap-2">
          <Button variant="line" size="sm" onClick={() => setDiscardOpen(true)} disabled={pending}>
            Discard changes
          </Button>
          <Button variant="primary" size="sm" onClick={handleCommit} disabled={pending}>
            Save & relock
          </Button>
        </div>
      </div>
      <DeleteDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard changes made during this session?"
        description={
          session.scope === "FULL"
            ? "Structure and financials will be restored to how they were when this session was opened. Asset/kit warehouse state is never touched — anything that can't be safely restored is flagged for manual review."
            : "Money fields will be restored to how they were when this session was opened. Structural changes (items added/removed) are kept — an item added during this session reverts to $0/unpriced."
        }
        confirmLabel="Discard"
        onConfirm={handleDiscard}
        pending={pending}
      />
    </>
  );
}
