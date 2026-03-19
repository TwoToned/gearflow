/**
 * Evaluates section visibility conditions against document data.
 * Used at PDF generation time (server) and preview time (client).
 */
import type { DocumentType, DocumentData } from "./types";
import type { TemplateSection, SectionVisibility, VisibilityCondition } from "./section-types";

/**
 * Whitelist of allowed fields for visibility conditions.
 * Only flat string/number fields from DocumentData are allowed.
 * Prevents arbitrary property access or injection.
 */
const ALLOWED_CONDITION_FIELDS = new Set([
  // Org
  "org_name", "org_email", "org_phone", "org_address", "org_website",
  "org_tax_rate", "org_tax_label", "org_document_color",
  // Project
  "project_number", "project_name", "project_status", "project_type",
  // Dates
  "rental_start", "rental_end", "event_start", "event_end",
  "load_in_date", "load_out_date",
  // Client
  "client_name", "client_contact", "client_email", "client_phone",
  "client_billing_address", "client_tax_id", "client_payment_terms",
  // Location
  "venue_name", "venue_address", "site_contact_name",
  "site_contact_phone", "site_contact_email",
  // Financial
  "subtotal", "discount_percent", "discount_amount",
  "tax_label", "tax_amount", "total", "deposit_paid", "balance_due",
  // Notes
  "client_notes", "crew_notes", "internal_notes",
  // Metadata
  "document_date",
  // Computed
  "total_items", "total_weight",
]);

/**
 * Get the list of allowed condition fields (for UI autocomplete).
 */
export function getAllowedConditionFields(): string[] {
  return Array.from(ALLOWED_CONDITION_FIELDS).sort();
}

/**
 * Check if a field name is allowed for conditions.
 */
export function isAllowedConditionField(field: string): boolean {
  return ALLOWED_CONDITION_FIELDS.has(field);
}

/**
 * Evaluate a single visibility condition against document data.
 * Returns true if the condition is met (section should be visible).
 */
export function evaluateCondition(
  condition: VisibilityCondition,
  data: DocumentData
): boolean {
  if (!isAllowedConditionField(condition.field)) {
    // Unknown field — default to hidden (safe default)
    return false;
  }

  const fieldValue = (data as unknown as Record<string, unknown>)[condition.field];

  switch (condition.operator) {
    case "exists":
      return fieldValue !== null && fieldValue !== undefined && fieldValue !== "" && fieldValue !== 0;
    case "not_exists":
      return fieldValue === null || fieldValue === undefined || fieldValue === "" || fieldValue === 0;
    case "equals":
      return String(fieldValue ?? "") === (condition.value ?? "");
    case "not_equals":
      return String(fieldValue ?? "") !== (condition.value ?? "");
    default:
      return true;
  }
}

/**
 * Evaluate full section visibility (doc type filter + data condition).
 * Returns true if the section should be visible.
 */
export function evaluateVisibility(
  visibility: SectionVisibility,
  docType: DocumentType,
  data: DocumentData
): boolean {
  // Check document type filter
  if (visibility.docTypes && visibility.docTypes.length > 0) {
    if (!visibility.docTypes.includes(docType)) {
      return false;
    }
  }

  // Check data condition
  if (visibility.condition) {
    return evaluateCondition(visibility.condition, data);
  }

  return true;
}

/**
 * Filter a section list to only visible sections for a given doc type and data.
 */
export function filterVisibleSections(
  sections: TemplateSection[],
  docType: DocumentType,
  data: DocumentData
): TemplateSection[] {
  return sections.filter((section) =>
    evaluateVisibility(section.visibility, docType, data)
  );
}
