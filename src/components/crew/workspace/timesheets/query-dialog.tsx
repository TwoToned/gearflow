"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { timeEntryQuerySchema } from "@/lib/validations/crew";
import { QUERY_REASON_MAX } from "../../../../../convex/lib/timeEntryQuery";

/**
 * Query… (D47): what needs checking, sent back to the crew member. The reason
 * is required (Save stays disabled until one is typed) and bounded by the
 * same `timeEntryQuerySchema` the write parses; it is stored on the entry's
 * `queryReason`, never on their own notes.
 */
export function QueryDialog({
  ids,
  onOpenChange,
  onQuery,
}: {
  /** The SUBMITTED / APPROVED entries to query; null = closed. */
  ids: string[] | null;
  onOpenChange: (open: boolean) => void;
  /** Resolves true when the query went through (the dialog then closes). */
  onQuery: (ids: string[], reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const n = ids?.length ?? 0;
  const valid = timeEntryQuerySchema.safeParse({ reason }).success;
  const change = (open: boolean) => {
    if (!open) setReason("");
    onOpenChange(open);
  };
  const submit = async () => {
    if (!ids || !valid) return;
    setSaving(true);
    const ok = await onQuery(ids, reason.trim());
    setSaving(false);
    if (ok) change(false);
  };
  return (
    <Dialog open={!!ids} onOpenChange={change}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{`Query ${n} ${n === 1 ? "entry" : "entries"}`}</DialogTitle>
          <DialogDescription>
            {n === 1 ? "It returns" : "They return"} to the crew member as Queried. They fix the hours and submit again. An approved entry loses its approval.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="query-reason">What needs checking</Label>
          <Textarea
            id="query-reason"
            value={reason}
            maxLength={QUERY_REASON_MAX}
            placeholder="e.g. No break logged on a 14 hour day"
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="text-caption text-muted">Saved on the entry as its query, not in the crew member&apos;s notes.</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="line" onClick={() => change(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!valid} loading={saving} onClick={() => void submit()}>
            {`Query ${n}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
