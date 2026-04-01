/**
 * Centralized status color system.
 *
 * Every status enum in the app maps to a semantic color intent here.
 * Components use `getStatusColor(category, value)` to look up styles,
 * eliminating scattered inline color maps across 20+ files.
 *
 * Color intents map to CSS custom properties from DESIGN.md:
 *   success → --success / --success-subtle
 *   warning → --warning / --warning-subtle
 *   error   → --error   / --error-subtle
 *   info    → --info    / --info-subtle
 *   neutral → --fg-3    / --bg-inset
 *   primary → --primary / --teal-subtle
 */

export type ColorIntent = "success" | "warning" | "error" | "info" | "neutral" | "primary";

/** CSS classes for each color intent — dot + text pattern */
export const intentStyles: Record<ColorIntent, {
  dot: string;
  text: string;
  pill: string;
  bg: string;
}> = {
  success: {
    dot: "bg-success",
    text: "text-success",
    pill: "bg-success-subtle text-success",
    bg: "bg-success-subtle",
  },
  warning: {
    dot: "bg-warning",
    text: "text-warning",
    pill: "bg-warning-subtle text-warning",
    bg: "bg-warning-subtle",
  },
  error: {
    dot: "bg-error",
    text: "text-error",
    pill: "bg-error-subtle text-error",
    bg: "bg-error-subtle",
  },
  info: {
    dot: "bg-info",
    text: "text-info",
    pill: "bg-info-subtle text-info",
    bg: "bg-info-subtle",
  },
  neutral: {
    dot: "bg-fg-3",
    text: "text-fg-3",
    pill: "bg-bg-inset text-fg-3",
    bg: "bg-bg-inset",
  },
  primary: {
    dot: "bg-primary",
    text: "text-primary",
    pill: "bg-teal-subtle text-primary",
    bg: "bg-teal-subtle",
  },
};

// ─── Status → Intent Mappings ───────────────────────────────────

const assetStatusIntent: Record<string, ColorIntent> = {
  AVAILABLE: "success",
  CHECKED_OUT: "primary",
  IN_MAINTENANCE: "warning",
  RESERVED: "info",
  RETIRED: "neutral",
  LOST: "error",
};

const bulkAssetStatusIntent: Record<string, ColorIntent> = {
  ACTIVE: "success",
  LOW_STOCK: "warning",
  OUT_OF_STOCK: "error",
  RETIRED: "neutral",
};

const kitStatusIntent: Record<string, ColorIntent> = {
  AVAILABLE: "success",
  CHECKED_OUT: "primary",
  IN_MAINTENANCE: "warning",
  RETIRED: "neutral",
  INCOMPLETE: "error",
};

const projectStatusIntent: Record<string, ColorIntent> = {
  ENQUIRY: "neutral",
  QUOTING: "info",
  QUOTED: "info",
  CONFIRMED: "success",
  PREPPING: "warning",
  CHECKED_OUT: "primary",
  ON_SITE: "primary",
  RETURNED: "primary",
  COMPLETED: "success",
  INVOICED: "success",
  CANCELLED: "error",
};

const lineItemStatusIntent: Record<string, ColorIntent> = {
  QUOTED: "info",
  CONFIRMED: "success",
  PREPPED: "warning",
  CHECKED_OUT: "primary",
  RETURNED: "primary",
  CANCELLED: "error",
};

const maintenanceStatusIntent: Record<string, ColorIntent> = {
  SCHEDULED: "info",
  IN_PROGRESS: "warning",
  COMPLETED: "success",
  CANCELLED: "error",
};

const supplierOrderStatusIntent: Record<string, ColorIntent> = {
  DRAFT: "neutral",
  ORDERED: "info",
  PARTIAL: "warning",
  RECEIVED: "success",
  CANCELLED: "error",
};

const subHireStatusIntent: Record<string, ColorIntent> = {
  DRAFT: "neutral",
  CONFIRMED: "warning",
  ON_HIRE: "info",
  RETURNED: "success",
  CANCELLED: "neutral",
};

const conditionIntent: Record<string, ColorIntent> = {
  NEW: "success",
  GOOD: "info",
  FAIR: "warning",
  POOR: "error",
  DAMAGED: "error",
};

const crewMemberStatusIntent: Record<string, ColorIntent> = {
  ACTIVE: "success",
  INACTIVE: "neutral",
  ON_LEAVE: "warning",
  ARCHIVED: "neutral",
};

const assignmentStatusIntent: Record<string, ColorIntent> = {
  PENDING: "neutral",
  OFFERED: "info",
  ACCEPTED: "primary",
  DECLINED: "error",
  CONFIRMED: "success",
  CANCELLED: "error",
  COMPLETED: "success",
};

const shiftStatusIntent: Record<string, ColorIntent> = {
  SCHEDULED: "info",
  IN_PROGRESS: "warning",
  COMPLETED: "success",
  CANCELLED: "error",
  NO_SHOW: "error",
};

const timeEntryStatusIntent: Record<string, ColorIntent> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  APPROVED: "success",
  DISPUTED: "warning",
  EXPORTED: "success",
};

const clientTypeIntent: Record<string, ColorIntent> = {
  COMPANY: "info",
  INDIVIDUAL: "primary",
  VENUE: "warning",
  PRODUCTION_COMPANY: "success",
};

const locationTypeIntent: Record<string, ColorIntent> = {
  WAREHOUSE: "info",
  VENUE: "warning",
  VEHICLE: "primary",
  OFFSITE: "neutral",
};

const memberRoleIntent: Record<string, ColorIntent> = {
  owner: "warning",
  admin: "info",
  manager: "primary",
  member: "success",
  staff: "success",
  warehouse: "warning",
  viewer: "neutral",
};

const activityActionIntent: Record<string, ColorIntent> = {
  CREATE: "success",
  UPDATE: "info",
  DELETE: "error",
  STATUS_CHANGE: "primary",
  CHECK_OUT: "warning",
  CHECK_IN: "warning",
  SCAN: "neutral",
  ASSIGN: "primary",
  UNASSIGN: "primary",
  EXPORT: "info",
  IMPORT: "info",
  INVITE: "info",
};

const notificationSeverityIntent: Record<string, ColorIntent> = {
  error: "error",
  warning: "warning",
  info: "info",
};

// ─── Category Registry ──────────────────────────────────────────

export type StatusCategory =
  | "asset"
  | "bulkAsset"
  | "kit"
  | "project"
  | "lineItem"
  | "maintenance"
  | "supplierOrder"
  | "condition"
  | "crewMember"
  | "assignment"
  | "shift"
  | "timeEntry"
  | "clientType"
  | "locationType"
  | "memberRole"
  | "activity"
  | "notification"
  | "subHire";

const categoryMap: Record<StatusCategory, Record<string, ColorIntent>> = {
  asset: assetStatusIntent,
  bulkAsset: bulkAssetStatusIntent,
  kit: kitStatusIntent,
  project: projectStatusIntent,
  lineItem: lineItemStatusIntent,
  maintenance: maintenanceStatusIntent,
  supplierOrder: supplierOrderStatusIntent,
  condition: conditionIntent,
  crewMember: crewMemberStatusIntent,
  assignment: assignmentStatusIntent,
  shift: shiftStatusIntent,
  timeEntry: timeEntryStatusIntent,
  clientType: clientTypeIntent,
  locationType: locationTypeIntent,
  memberRole: memberRoleIntent,
  activity: activityActionIntent,
  notification: notificationSeverityIntent,
  subHire: subHireStatusIntent,
};

/**
 * Get the color intent for a status value.
 *
 * @example
 * getStatusIntent("asset", "AVAILABLE")  // → "success"
 * getStatusIntent("project", "CANCELLED") // → "error"
 */
export function getStatusIntent(category: StatusCategory, value: string): ColorIntent {
  return categoryMap[category]?.[value] ?? "neutral";
}

/**
 * Get the full style object for a status value.
 *
 * @example
 * const styles = getStatusColor("asset", "AVAILABLE");
 * // styles.dot → "bg-success"
 * // styles.text → "text-success"
 * // styles.pill → "bg-success-subtle text-success"
 */
export function getStatusColor(category: StatusCategory, value: string) {
  const intent = getStatusIntent(category, value);
  return intentStyles[intent];
}
