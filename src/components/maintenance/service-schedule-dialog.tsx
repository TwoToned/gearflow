"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";

import { useActiveOrganization } from "@/lib/auth-client";
import { useModels } from "@/hooks/use-models";
import { useServiceScheduleWrites, type ServiceScheduleRow } from "@/hooks/use-service-schedules";
import { useServerMutation } from "@/hooks/use-server-mutation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { Loader2 } from "lucide-react";

interface ServiceScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present = editing; absent = creating a new schedule. */
  schedule?: ServiceScheduleRow;
  /** Pre-select a model (e.g. opened from a model's detail page). */
  defaultModelId?: string;
}

/**
 * WS6 #945 — create/edit dialog for a recurring preventative-maintenance
 * schedule. Small controlled-state form (mirrors quick-create-category.tsx),
 * not a full SmartFormLayout page — schedules are a lightweight sub-resource
 * managed from the /maintenance/due worklist.
 */
export function ServiceScheduleDialog({ open, onOpenChange, schedule, defaultModelId }: ServiceScheduleDialogProps) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const models = useModels(orgId);
  const isEditing = !!schedule;

  const [modelId, setModelId] = useState(schedule?.modelId ?? defaultModelId ?? "");
  const [name, setName] = useState(schedule?.name ?? "");
  const [intervalMonths, setIntervalMonths] = useState(String(schedule?.intervalMonths ?? 6));
  const [anchorDate, setAnchorDate] = useState(
    schedule?.anchorDate ? format(new Date(schedule.anchorDate), "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"),
  );
  const [instructions, setInstructions] = useState(schedule?.instructions ?? "");

  // Re-seed local state whenever a DIFFERENT schedule is opened for editing
  // (the dialog instance is shared across rows).
  useEffect(() => {
    if (!open) return;
    setModelId(schedule?.modelId ?? defaultModelId ?? "");
    setName(schedule?.name ?? "");
    setIntervalMonths(String(schedule?.intervalMonths ?? 6));
    setAnchorDate(schedule?.anchorDate ? format(new Date(schedule.anchorDate), "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"));
    setInstructions(schedule?.instructions ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, schedule?.id]);

  const modelOptions = useMemo(
    () => (models ?? []).map((m) => ({ value: m.id, label: m.name })),
    [models],
  );

  const writes = useServiceScheduleWrites();
  const mutation = useServerMutation({
    mutationFn: () =>
      isEditing
        ? writes.update(schedule!.id, {
            modelId,
            name,
            intervalMonths,
            // Server action dates arrive as strings — wrap with new Date().
            anchorDate: new Date(anchorDate),
            instructions: instructions || undefined,
            isActive: schedule!.isActive,
          })
        : writes.create({
            modelId,
            name,
            intervalMonths,
            anchorDate: new Date(anchorDate),
            instructions: instructions || undefined,
            isActive: true,
          }),
    onSuccess: () => {
      toast.success(isEditing ? "Schedule updated" : "Schedule created");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const canSubmit = modelId.length > 0 && name.trim().length > 0 && Number(intervalMonths) >= 1 && !!anchorDate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit service schedule" : "New service schedule"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Model</Label>
            <ComboboxPicker
              value={modelId}
              onChange={setModelId}
              options={modelOptions}
              placeholder="Select a model..."
              searchPlaceholder="Search models..."
              disabled={isEditing} // model isn't editable post-create (see serviceSchedulesWrites.ts)
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sched-name">Name</Label>
            <Input
              id="sched-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. 6-month service"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="sched-interval">Interval (months)</Label>
              <Input
                id="sched-interval"
                type="number"
                min={1}
                max={120}
                value={intervalMonths}
                onChange={(e) => setIntervalMonths(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sched-anchor">Anchor date</Label>
              <Input
                id="sched-anchor"
                type="date"
                value={anchorDate}
                onChange={(e) => setAnchorDate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sched-instructions">Instructions (optional)</Label>
            <Textarea
              id="sched-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="What does this service check/do?"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="line" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? "Save changes" : "Create schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
