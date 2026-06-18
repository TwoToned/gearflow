/**
 * Human-readable labels for all enum values displayed in the UI.
 * Use `formatLabel(enumValue)` as a fallback for any enum not listed here.
 */

// --- Asset Status ---
export const assetStatusLabels: Record<string, string> = {
  AVAILABLE: "Available",
  CHECKED_OUT: "Deployed",
  IN_MAINTENANCE: "In maintenance",
  RETIRED: "Retired",
  LOST: "Lost",
  RESERVED: "Reserved",
};

// --- Bulk Asset Status ---
export const bulkAssetStatusLabels: Record<string, string> = {
  ACTIVE: "Active",
  LOW_STOCK: "Low stock",
  OUT_OF_STOCK: "Out of stock",
  RETIRED: "Retired",
};

// --- Kit Status ---
export const kitStatusLabels: Record<string, string> = {
  AVAILABLE: "Available",
  CHECKED_OUT: "Deployed",
  IN_MAINTENANCE: "In maintenance",
  RETIRED: "Retired",
  INCOMPLETE: "Incomplete",
};

// --- Project Status ---
export const projectStatusLabels: Record<string, string> = {
  ENQUIRY: "Enquiry",
  QUOTING: "Quoting",
  QUOTED: "Quoted",
  CONFIRMED: "Confirmed",
  PREPPING: "Prepping",
  CHECKED_OUT: "Deployed",
  ON_SITE: "On site",
  RETURNED: "Returned",
  COMPLETED: "Completed",
  INVOICED: "Invoiced",
  CANCELLED: "Cancelled",
};

// --- Line Item Status ---
export const lineItemStatusLabels: Record<string, string> = {
  QUOTED: "Quoted",
  CONFIRMED: "Confirmed",
  PREPPED: "Prepped",
  CHECKED_OUT: "Deployed",
  RETURNED: "Returned",
  CANCELLED: "Cancelled",
};

// --- Maintenance Status ---
export const maintenanceStatusLabels: Record<string, string> = {
  SCHEDULED: "Scheduled",
  AWAITING_PARTS: "Awaiting parts",
  IN_PROGRESS: "In progress",
  QA: "QA",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

// --- Maintenance Type ---
export const maintenanceTypeLabels: Record<string, string> = {
  REPAIR: "Repair",
  PREVENTATIVE: "Preventative",
  TEST_AND_TAG: "Test & tag",
  INSPECTION: "Inspection",
  CLEANING: "Cleaning",
  FIRMWARE_UPDATE: "Firmware update",
};

// --- Maintenance Result ---
export const maintenanceResultLabels: Record<string, string> = {
  PASS: "Pass",
  FAIL: "Fail",
  CONDITIONAL: "Conditional",
};

// --- Supplier Order Status ---
export const supplierOrderStatusLabels: Record<string, string> = {
  DRAFT: "Draft",
  ORDERED: "Ordered",
  PARTIAL: "Partial",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};

export const subHireStatusLabels: Record<string, string> = {
  DRAFT: "Draft",
  CONFIRMED: "Confirmed",
  ON_HIRE: "On hire",
  RETURNED: "Returned",
  CANCELLED: "Cancelled",
};

// --- Media Type ---
export const mediaTypeLabels: Record<string, string> = {
  PHOTO: "Photo",
  MANUAL: "Manual",
  SPEC_SHEET: "Spec sheet",
  WIRING_DIAGRAM: "Wiring diagram",
  DOCUMENT: "Document",
  OTHER: "Other",
};

// --- Project Media Type ---
export const projectMediaTypeLabels: Record<string, string> = {
  FLOOR_PLAN: "Floor plan",
  QUOTE: "Quote",
  INVOICE: "Invoice",
  SITE_MAP: "Site map",
  RISK_ASSESSMENT: "Risk assessment",
  CLIENT_BRIEF: "Client brief",
  CAD: "CAD",
  CONTRACT: "Contract",
  PHOTO: "Photo",
  OTHER: "Other",
};

// --- Asset Condition ---
export const conditionLabels: Record<string, string> = {
  NEW: "New",
  GOOD: "Good",
  FAIR: "Fair",
  POOR: "Poor",
  DAMAGED: "Damaged",
};

// --- Client Type ---
export const clientTypeLabels: Record<string, string> = {
  COMPANY: "Company",
  INDIVIDUAL: "Individual",
  VENUE: "Venue",
  PRODUCTION_COMPANY: "Production company",
};

// --- Location Type ---
export const locationTypeLabels: Record<string, string> = {
  WAREHOUSE: "Warehouse",
  VENUE: "Venue",
  VEHICLE: "Vehicle",
  OFFSITE: "Offsite",
};

// --- Crew Member Status ---
export const crewMemberStatusLabels: Record<string, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  ON_LEAVE: "On leave",
  ARCHIVED: "Archived",
};

// --- Crew Member Type ---
export const crewMemberTypeLabels: Record<string, string> = {
  EMPLOYEE: "Employee",
  FREELANCER: "Freelancer",
  CONTRACTOR: "Contractor",
  VOLUNTEER: "Volunteer",
};

// --- Crew Rate Type ---
export const crewRateTypeLabels: Record<string, string> = {
  HOURLY: "Hourly",
  DAILY: "Daily",
  FLAT: "Flat",
};

// --- Crew Assignment Status ---
export const assignmentStatusLabels: Record<string, string> = {
  PENDING: "Pending",
  OFFERED: "Offered",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
};

// --- Project Phase ---
export const phaseLabels: Record<string, string> = {
  BUMP_IN: "Bump in",
  EVENT: "Event",
  BUMP_OUT: "Bump out",
  DELIVERY: "Delivery",
  PICKUP: "Pickup",
  SETUP: "Setup",
  REHEARSAL: "Rehearsal",
  FULL_DURATION: "Full duration",
};

// --- Shift Status ---
export const shiftStatusLabels: Record<string, string> = {
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No show",
};

// --- Time Entry Status ---
export const timeEntryStatusLabels: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  DISPUTED: "Disputed",
  EXPORTED: "Exported",
};

// --- Availability Type ---
export const availabilityTypeLabels: Record<string, string> = {
  UNAVAILABLE: "Unavailable",
  TENTATIVE: "Tentative",
  PREFERRED: "Preferred",
};

/**
 * Generic fallback: converts ANY_ENUM_VALUE to "Any Enum Value".
 * Use the specific label maps above when possible.
 */
export function formatLabel(value: string): string {
  return value
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}
