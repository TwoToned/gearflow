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
 *   error   → --error   / --error-subtle  (tinted red — problem state)
 *   info    → --info    / --info-subtle
 *   neutral → --fg-3    / --bg-inset
 *   primary → --red (solid fill — live/active/in-use state)
 *
 * Red disambiguation (DESIGN.md §1) — RVLT token names:
 *   primary pill = bg-red text-white                (solid red = LIVE/ACTIVE)
 *   error pill   = bg-out-soft text-t-out            (tinted red = PROBLEM)
 *   --red = #E0363D (primary accent)
 *   --t-out = #F26F73 (overdue/timed-out semantic, lighter red)
 *   --out-soft = rgba(224,54,61,.18) (subtle red tint for error bg)
 */

export type ColorIntent = "success" | "warning" | "error" | "info" | "neutral" | "primary";

/** CSS classes for each color intent — dot + text pattern */
export const intentStyles: Record<ColorIntent, {
  dot: string;
  text: string;
  pill: string;
  bg: string;
}> = {
  // RVLT token names: --ok (green), --warn (amber), --red/--t-out (red),
  // --blue (info), --rep (neutral/muted), --red (primary/live)
  success: {
    dot: "bg-ok",
    text: "text-ok",
    pill: "bg-ok-soft text-ok",
    bg: "bg-ok-soft",
  },
  warning: {
    dot: "bg-warn",
    text: "text-warn",
    pill: "bg-warn-soft text-warn",
    bg: "bg-warn-soft",
  },
  error: {
    dot: "bg-t-out",
    text: "text-t-out",
    pill: "bg-out-soft text-t-out",
    bg: "bg-out-soft",
  },
  info: {
    dot: "bg-blue",
    text: "text-blue",
    pill: "bg-blue-soft text-blue",
    bg: "bg-blue-soft",
  },
  neutral: {
    dot: "bg-rep",
    text: "text-rep",
    pill: "bg-rep-soft text-rep",
    bg: "bg-rep-soft",
  },
  primary: {
    dot: "bg-red",
    text: "text-red",
    pill: "bg-red text-white",
    bg: "bg-red-soft",
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
  // WS11 (#950) — terminal like RETIRED, neutral (not an error/problem state).
  SOLD: "neutral",
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
  AWAITING_PARTS: "warning",
  IN_PROGRESS: "primary", // §1: active work = live red
  QA: "warning",
  COMPLETED: "success",
  CANCELLED: "error",
};

// Maintenance work-order result (MaintenanceResult enum). §1: a FAIL is a
// problem (t-out/error), a CONDITIONAL is a caution (warning), a PASS is good.
const maintenanceResultIntent: Record<string, ColorIntent> = {
  PASS: "success",
  FAIL: "error",
  CONDITIONAL: "warning",
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

// Crew availability windows (CrewAvailabilityType enum). Used by the crew planner
// board cells. UNAVAILABLE = a hard block (problem/error tint), TENTATIVE = soft
// (warning), PREFERRED = good-to-book (success).
const availabilityTypeIntent: Record<string, ColorIntent> = {
  UNAVAILABLE: "error",
  TENTATIVE: "warning",
  PREFERRED: "success",
};

// Test & Tag compliance status (computed per-asset). §1: OVERDUE/FAILED are a
// problem (t-out/error), DUE_SOON is a caution (warning), a CURRENT/valid test
// is success (ok). NOT_YET_TESTED + RETIRED are neutral.
const testTagStatusIntent: Record<string, ColorIntent> = {
  CURRENT: "success",
  DUE_SOON: "warning",
  OVERDUE: "error",
  FAILED: "error",
  NOT_YET_TESTED: "neutral",
  RETIRED: "neutral",
};

// Test & Tag test result (TestResult enum). §1: a FAIL is a problem (t-out/error),
// a PASS is good (ok), NOT_APPLICABLE is neutral.
const testTagResultIntent: Record<string, ColorIntent> = {
  PASS: "success",
  FAIL: "error",
  NOT_APPLICABLE: "neutral",
};

const serviceStatusIntent: Record<string, ColorIntent> = {
  PLANNED: "neutral",
  CONFIRMED: "info",
  IN_PROGRESS: "primary",
  COMPLETED: "success",
  CANCELLED: "error",
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

// Crew conflict/availability severity (WS8 #947) — the picker badge, the
// crew-table conflict column, and the assignment edit dialog's conflict
// banners all key off this ONE map instead of each hand-picking a color.
// "hard" = a real hold on the crew member's time (UNAVAILABLE block, or a
// CONFIRMED/ACCEPTED/COMPLETED overlapping assignment — "Booked"). "soft" = a
// speculative hold (TENTATIVE block, or a PENDING/OFFERED overlapping
// assignment — "Pencilled"). "preferred" = a positive hint (the crew member
// WANTS this work), never a conflict.
const conflictSeverityIntent: Record<string, ColorIntent> = {
  hard: "error",
  soft: "warning",
  preferred: "success",
};

// Quote revision state (#989 — finance-workflow-ux.md §3.5). SENT is `info`
// (blue) and ACCEPTED is `primary` (solid red) — an earlier draft inverted
// these (SENT/ACCEPTED both mapped to a green "ok" pill in the Phase A rail's
// ad-hoc map), which contradicted DESIGN.md's own worked example: solid red is
// LIVE/ACTIVE and explicitly names ACCEPTED as a member. SUPERSEDED has no
// entry — a dead revision doesn't earn a filled pill (rendered as plain
// `text-muted` text by the caller, not looked up here).
const quoteStatusIntentMap: Record<string, ColorIntent> = {
  DRAFT: "neutral",
  SENT: "info",
  ACCEPTED: "primary",
  DECLINED: "error",
  EXPIRED: "warning",
  RECALLED: "warning",
};

// ─── Category Registry ──────────────────────────────────────────

export type StatusCategory =
  | "asset"
  | "bulkAsset"
  | "kit"
  | "project"
  | "lineItem"
  | "maintenance"
  | "maintenanceResult"
  | "supplierOrder"
  | "condition"
  | "crewMember"
  | "assignment"
  | "availabilityType"
  | "service"
  | "shift"
  | "timeEntry"
  | "clientType"
  | "locationType"
  | "memberRole"
  | "activity"
  | "notification"
  | "subHire"
  | "testTag"
  | "testTagResult"
  | "conflictSeverity"
  | "quote";

const categoryMap: Record<StatusCategory, Record<string, ColorIntent>> = {
  asset: assetStatusIntent,
  bulkAsset: bulkAssetStatusIntent,
  kit: kitStatusIntent,
  project: projectStatusIntent,
  lineItem: lineItemStatusIntent,
  maintenance: maintenanceStatusIntent,
  maintenanceResult: maintenanceResultIntent,
  supplierOrder: supplierOrderStatusIntent,
  condition: conditionIntent,
  crewMember: crewMemberStatusIntent,
  assignment: assignmentStatusIntent,
  availabilityType: availabilityTypeIntent,
  service: serviceStatusIntent,
  shift: shiftStatusIntent,
  timeEntry: timeEntryStatusIntent,
  clientType: clientTypeIntent,
  locationType: locationTypeIntent,
  memberRole: memberRoleIntent,
  activity: activityActionIntent,
  notification: notificationSeverityIntent,
  subHire: subHireStatusIntent,
  testTag: testTagStatusIntent,
  testTagResult: testTagResultIntent,
  conflictSeverity: conflictSeverityIntent,
  quote: quoteStatusIntentMap,
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

/**
 * Left-accent border class for an intent's colored card/callout treatment
 * (e.g. `border-l-[3px] border-l-t-out`) — derived from the same token as
 * `dot` instead of a caller hand-picking a color name. Reuses the
 * `border-l-<token>` convention already used verbatim across the app
 * (csv-import-dialog, equipment-add-form, crew-panel, etc.) so a caller
 * migrating a hardcoded `border-l-t-out`/`border-l-warn` string keeps the
 * exact same visual result while going through the shared intent system.
 *
 * @example
 * intentBorderClass("error")   // → "border-l-t-out"
 * intentBorderClass("warning") // → "border-l-warn"
 */
export function intentBorderClass(intent: ColorIntent): string {
  return intentStyles[intent].dot.replace(/^bg-/, "border-l-");
}

/**
 * Quote revision state → intent (#989), alongside `assetStatusIntent`. Callers
 * render `SUPERSEDED` as plain `text-muted` text rather than calling this —
 * a dead revision doesn't earn a filled pill (finance-workflow-ux.md §3.5).
 *
 * @example
 * quoteStatusIntent("SENT")     // → "info"
 * quoteStatusIntent("ACCEPTED") // → "primary"
 */
export function quoteStatusIntent(status: string): ColorIntent {
  return getStatusIntent("quote", status);
}
