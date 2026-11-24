"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";

import { api } from "../../../../convex/_generated/api";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/lib/auth-client";
import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";

/** `2026-11-24` for an `<input type=date>` from epoch ms (local day). */
const toInput = (ms: number | null | undefined) => (ms == null ? "" : new Date(ms).toISOString().slice(0, 10));
const fromInput = (s: string) => new Date(`${s}T00:00:00.000Z`).getTime();

export type HireMode = "return" | "extend";

/**
 * `Mark returned…` and `Extend hire…` (D71). Each is one write that toasts with Undo; the Undo
 * is `undoHireChangeNative` with only the forward audit id, which the server reverses only
 * while the field is still exactly what that write left (the shared `fieldEditUndo`).
 * Extend moves the SUPPLIER's return date and never the sub-hire's own hire window.
 */
export function HireDateDialog({
  mode,
  onOpenChange,
  orgId,
  order,
}: {
  mode: HireMode | null;
  onOpenChange: (open: boolean) => void;
  orgId: string | undefined;
  order: { id: string; orderNumber: string; returnDueDate: number | null };
}) {
  const { data: session } = useSession();
  const markReturned = useMutation(api.supplierOrdersWrites.markReturnedNative);
  const extend = useMutation(api.supplierOrdersWrites.extendHireNative);
  const undo = useMutation(api.supplierOrdersWrites.undoHireChangeNative);
  const today = toInput(Date.now());
  const [value, setValue] = React.useState(today);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (mode === "return") setValue(today);
    if (mode === "extend") setValue(toInput((order.returnDueDate ?? Date.now()) + 24 * 60 * 60 * 1000));
  }, [mode, order.returnDueDate, today]);
  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });

  async function run() {
    if (!orgId || !mode || !value) return;
    setBusy(true);
    const auditId = createId();
    try {
      const base = { id: order.id, orgId, now: Date.now(), actor: actor(), auditId };
      if (mode === "return") await markReturned({ ...base, returnedDate: fromInput(value) });
      else await extend({ ...base, returnDueDate: fromInput(value) });
      announceListWrite({
        title: mode === "return" ? `${order.orderNumber} marked returned` : `Hire on ${order.orderNumber} extended`,
        undoneTitle: "Undone",
        performUndo: async () => {
          await undo({ id: order.id, orgId, forwardAuditId: auditId, now: Date.now(), actor: actor() });
        },
      });
      onOpenChange(false);
    } catch (e) {
      showError(e, { fallbackTitle: mode === "return" ? "Could not mark it returned" : "Could not extend the hire" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={mode !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{mode === "return" ? `Mark ${order.orderNumber} returned` : `Extend hire on ${order.orderNumber}`}</DialogTitle>
          <DialogDescription>
            {mode === "return" ? "The date the gear went back to the supplier." : "The new date the supplier should expect the gear back. The job's own hire window is not changed."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="hire-date">{mode === "return" ? "Returned on" : "Return due"}</Label>
          <Input id="hire-date" type="date" value={value} onChange={(e) => setValue(e.target.value)} className="h-11 text-base md:h-9 md:text-ui-text" />
        </div>
        <DialogFooter>
          <Button variant="line" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void run()} disabled={!value || busy} loading={busy}>{mode === "return" ? "Mark returned" : "Extend hire"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
