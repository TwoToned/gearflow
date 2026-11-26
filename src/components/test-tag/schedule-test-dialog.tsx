"use client";

import * as React from "react";

import { dateInputMs } from "@/components/maintenance/maintenance-bulk-dialogs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMaintenanceWrites } from "@/hooks/use-maintenance-writes";
import { announceListWrite } from "@/lib/list-write-toast";
import { showError } from "@/lib/show-error";
import { planTestSchedule, testScheduleTitle, testScheduleToast, type ScheduleItem } from "@/lib/test-tag-schedule";

/**
 * `Schedule…` (UX Phase 14, 14a-3b): plan a Test & tag job for the chosen items. It creates ONE scheduled maintenance job
 * covering their linked assets (an item with no linked asset is named as skipped); the toast's Undo is the create's own
 * exact reverse (`undoCreate`, ids only). `items` null = closed.
 */
export function ScheduleTestDialog({ items, onClose }: { items: ScheduleItem[] | null; onClose: () => void }) {
  const writes = useMaintenanceWrites();
  const [value, setValue] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const plan = planTestSchedule(items ?? []);
  const ms = dateInputMs(value);
  const submit = async () => {
    if (ms == null || !items || plan.assetIds.length === 0) return;
    setPending(true);
    try {
      const { id } = await writes.create({ type: "TEST_AND_TAG", status: "SCHEDULED", title: testScheduleTitle(items), assetIds: plan.assetIds, scheduledDate: new Date(ms), tags: [], photos: [] });
      announceListWrite({ title: testScheduleToast(plan.assetIds.length, plan.skipped), undoneTitle: "Scheduled job removed", performUndo: async () => void (await writes.undoCreate(id)) });
      setValue("");
      onClose();
    } catch (e) {
      showError(e, { fallbackTitle: "Could not schedule testing" });
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog open={items !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Schedule testing</DialogTitle>
          <DialogDescription>Books one Test &amp; tag job on the maintenance schedule for the linked assets.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="tt-schedule-date">Date</Label>
            <Input id="tt-schedule-date" type="date" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          {plan.skipped.length > 0 && (
            <p className="text-ui-text text-muted" role="status">
              {plan.assetIds.length === 0 ? "Nothing to schedule: " : "Left out: "}
              {plan.skipped.map((s) => `${s.name} (${s.why})`).join(", ")}.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="line" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} loading={pending} disabled={ms == null || plan.assetIds.length === 0}>Schedule</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
