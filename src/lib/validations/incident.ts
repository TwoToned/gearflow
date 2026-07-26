import { z } from "zod";

/**
 * "Report Issue" — the in-app successor to the deleted Discord `/fault` command
 * (GitHub #898, FEATUREDOCS/62-incident-reporting.md). Reuses `MaintenanceRecord`
 * directly (type=REPAIR) rather than a parallel model; these fields feed
 * `convex/incidentWrites.ts::reportIssueNative`.
 */
export const incidentReportSchema = z.object({
  projectId: z.string().optional(),
  lineItemId: z.string().optional(),
  assetId: z.string().optional(),
  incidentType: z.enum(["BROKEN_DAMAGED", "LOST_MISSING", "NEEDS_SERVICE"]),
  incidentSeverity: z.enum(["MINOR", "MAJOR"]),
  description: z.string().min(1, "Describe what happened").max(5000),
  photos: z.array(z.string()).min(1, "At least one photo is required"),
});

export type IncidentReportFormValues = z.input<typeof incidentReportSchema>;

export const INCIDENT_TYPE_LABELS: Record<string, string> = {
  BROKEN_DAMAGED: "Broken / damaged",
  LOST_MISSING: "Lost / missing",
  NEEDS_SERVICE: "Needs service",
};

export const INCIDENT_SEVERITY_LABELS: Record<string, string> = {
  MINOR: "Minor",
  MAJOR: "Major",
};
