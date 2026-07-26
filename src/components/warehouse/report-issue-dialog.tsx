"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PhotoGridInput } from "@/components/ui/photo-grid-input";
import { useIncidentWrites } from "@/hooks/use-incident-writes";
import {
  incidentReportSchema,
  INCIDENT_TYPE_LABELS,
  INCIDENT_SEVERITY_LABELS,
  type IncidentReportFormValues,
} from "@/lib/validations/incident";

/**
 * "Report Issue" — available on a project line item (CHECKED_OUT only), the
 * warehouse deploy/return tabs (CHECKED_OUT gear), and the asset detail page
 * (GitHub #898, FEATUREDOCS/64-incident-reporting.md). Creates a REPAIR
 * MaintenanceRecord and immediately flips the asset's status
 * (IN_MAINTENANCE / LOST) — no triage delay, per product decision.
 */
export interface ReportIssueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Label shown in the dialog title, e.g. the asset tag or model name. */
  targetLabel: string;
  projectId?: string;
  lineItemId?: string;
  assetId?: string;
  onReported?: () => void;
}

const INCIDENT_TYPES = ["BROKEN_DAMAGED", "NEEDS_SERVICE", "LOST_MISSING"] as const;
const SEVERITIES = ["MINOR", "MAJOR"] as const;

export function ReportIssueDialog({
  open,
  onOpenChange,
  targetLabel,
  projectId,
  lineItemId,
  assetId,
  onReported,
}: ReportIssueDialogProps) {
  const { reportIssue } = useIncidentWrites();
  const [incidentType, setIncidentType] = useState<IncidentReportFormValues["incidentType"]>("BROKEN_DAMAGED");
  const [incidentSeverity, setIncidentSeverity] = useState<IncidentReportFormValues["incidentSeverity"]>("MINOR");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [photosUploading, setPhotosUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setIncidentType("BROKEN_DAMAGED");
    setIncidentSeverity("MINOR");
    setDescription("");
    setPhotos([]);
    setError(null);
  }

  async function handleSubmit() {
    const parsed = incidentReportSchema.safeParse({
      projectId,
      lineItemId,
      assetId,
      incidentType,
      incidentSeverity,
      description,
      photos,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form and try again");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await reportIssue(parsed.data);
      toast.success("Issue reported", {
        description: `${targetLabel} flagged as ${INCIDENT_TYPE_LABELS[incidentType].toLowerCase()}`,
      });
      reset();
      onOpenChange(false);
      onReported?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to report issue");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warn" />
            Report issue — {targetLabel}
          </DialogTitle>
          <DialogDescription>
            Flags the asset and opens a maintenance record right away.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={incidentType} onValueChange={(v) => setIncidentType(v as typeof incidentType)}>
                <SelectTrigger>
                  <SelectValue>{INCIDENT_TYPE_LABELS[incidentType]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {INCIDENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {INCIDENT_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Severity</Label>
              <Select value={incidentSeverity} onValueChange={(v) => setIncidentSeverity(v as typeof incidentSeverity)}>
                <SelectTrigger>
                  <SelectValue>{INCIDENT_SEVERITY_LABELS[incidentSeverity]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {INCIDENT_SEVERITY_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>What happened?</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the issue..."
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Photos (required)</Label>
            <PhotoGridInput value={photos} onChange={setPhotos} onUploadingChange={setPhotosUploading} maxPhotos={6} compact />
          </div>

          {error && <p className="text-caption text-t-out">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="line" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || photosUploading || photos.length === 0 || description.trim().length === 0}
            loading={submitting}
          >
            {photosUploading ? "Uploading photos…" : "Report issue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
