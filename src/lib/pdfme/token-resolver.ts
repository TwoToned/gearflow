/**
 * Resolves {variable} tokens in pdfme template schemas and custom text sections.
 * Walks all schemas, finds text fields with {token_name} patterns,
 * and replaces them with values from DocumentData.
 *
 * Token whitelist: only known DocumentData fields are allowed. Unknown tokens
 * are replaced with "" (empty string) to prevent information leakage.
 */
import type { Template, Schema } from "@pdfme/common";
import type { DocumentData } from "./types";

const TOKEN_REGEX = /\{([a-z_][a-z0-9_]*)\}/gi;

/**
 * Whitelist of allowed token names. Derived from DocumentData flat fields.
 * Must be kept in sync with the DocumentData interface.
 */
const ALLOWED_TOKENS = new Set([
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
 * Get the list of allowed token names (for UI autocomplete).
 * Returns tokens grouped by category for display.
 */
export function getAllowedTokens(): { category: string; tokens: { name: string; label: string }[] }[] {
  return [
    {
      category: "Organisation",
      tokens: [
        { name: "org_name", label: "Organisation Name" },
        { name: "org_email", label: "Organisation Email" },
        { name: "org_phone", label: "Organisation Phone" },
        { name: "org_address", label: "Organisation Address" },
        { name: "org_website", label: "Organisation Website" },
      ],
    },
    {
      category: "Project",
      tokens: [
        { name: "project_name", label: "Project Name" },
        { name: "project_number", label: "Project Number" },
        { name: "project_status", label: "Project Status" },
        { name: "project_type", label: "Project Type" },
        { name: "document_date", label: "Document Date" },
      ],
    },
    {
      category: "Dates",
      tokens: [
        { name: "rental_start", label: "Rental Start" },
        { name: "rental_end", label: "Rental End" },
        { name: "event_start", label: "Event Start" },
        { name: "event_end", label: "Event End" },
        { name: "load_in_date", label: "Load In Date" },
        { name: "load_out_date", label: "Load Out Date" },
      ],
    },
    {
      category: "Client",
      tokens: [
        { name: "client_name", label: "Client Name" },
        { name: "client_contact", label: "Client Contact" },
        { name: "client_email", label: "Client Email" },
        { name: "client_phone", label: "Client Phone" },
        { name: "client_billing_address", label: "Billing Address" },
        { name: "client_tax_id", label: "Client ABN/Tax ID" },
        { name: "client_payment_terms", label: "Payment Terms" },
      ],
    },
    {
      category: "Location",
      tokens: [
        { name: "venue_name", label: "Venue Name" },
        { name: "venue_address", label: "Venue Address" },
        { name: "site_contact_name", label: "Site Contact Name" },
        { name: "site_contact_phone", label: "Site Contact Phone" },
        { name: "site_contact_email", label: "Site Contact Email" },
      ],
    },
    {
      category: "Financial",
      tokens: [
        { name: "subtotal", label: "Subtotal" },
        { name: "discount_percent", label: "Discount %" },
        { name: "discount_amount", label: "Discount Amount" },
        { name: "tax_label", label: "Tax Label" },
        { name: "tax_amount", label: "Tax Amount" },
        { name: "total", label: "Total" },
        { name: "deposit_paid", label: "Deposit Paid" },
        { name: "balance_due", label: "Balance Due" },
      ],
    },
    {
      category: "Notes",
      tokens: [
        { name: "client_notes", label: "Client Notes" },
        { name: "crew_notes", label: "Crew Notes" },
        { name: "internal_notes", label: "Internal Notes" },
      ],
    },
    {
      category: "Summary",
      tokens: [
        { name: "total_items", label: "Total Items" },
        { name: "total_weight", label: "Total Weight" },
      ],
    },
  ];
}

/**
 * Build a flat token map from DocumentData.
 * Only includes whitelisted flat fields (string/number primitives).
 */
export function buildTokenMap(data: DocumentData): Record<string, string> {
  const tokenMap: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!ALLOWED_TOKENS.has(key)) continue;
    if (typeof value === "string") {
      tokenMap[key] = value;
    } else if (typeof value === "number") {
      tokenMap[key] = String(value);
    }
  }
  return tokenMap;
}

/**
 * Resolve {token} placeholders in a text string.
 * Unknown/disallowed tokens are replaced with "" (empty string).
 * This is the primary function for section-based templates.
 */
export function resolveTokensInText(
  text: string,
  data: DocumentData
): string {
  const tokenMap = buildTokenMap(data);
  return text.replace(TOKEN_REGEX, (_match, tokenName) => {
    const key = tokenName.toLowerCase();
    return tokenMap[key] ?? "";
  });
}

/**
 * Resolve all {variable} tokens in a legacy template's schema content fields.
 * Returns the inputs array for pdfme generate().
 *
 * For custom plugins (gearflowTable, gearflowFinancialSummary, etc.),
 * the content is a JSON string containing the full data payload.
 * Token resolution only applies to simple text fields.
 */
export function resolveTokens(
  template: Template,
  data: DocumentData
): Record<string, string>[] {
  const tokenMap = buildTokenMap(data);

  const inputs: Record<string, string>[] = [];

  for (const pageSchemas of template.schemas) {
    const pageInputs: Record<string, string> = {};

    for (const schema of pageSchemas) {
      const s = schema as Schema & Record<string, unknown>;
      const name = s.name;
      const content = s.content || "";

      if (isCustomPlugin(s.type)) {
        pageInputs[name] = content;
      } else {
        pageInputs[name] = resolveString(content, tokenMap);
      }
    }

    inputs.push(pageInputs);
  }

  return inputs;
}

/**
 * Replace {token} placeholders in a string with values from the token map.
 */
function resolveString(
  text: string,
  tokenMap: Record<string, string>
): string {
  return text.replace(TOKEN_REGEX, (_match, tokenName) => {
    const key = tokenName.toLowerCase();
    return tokenMap[key] ?? "";
  });
}

/**
 * Custom plugin types that receive JSON data, not token-resolved text.
 * Both the legacy `gearflow*` names and the rebranded `rvltFlow*` aliases are
 * listed so a template using either name routes to JSON, not raw text. Mirrors
 * the alias keys in plugins/index.ts — keep the two in sync.
 */
const CUSTOM_PLUGIN_TYPES = new Set([
  "gearflowTable",
  "gearflowFinancialSummary",
  "gearflowPageHeader",
  "gearflowPageFooter",
  "gearflowCheckbox",
  "gearflowSignatureLine",
  "gearflowCrewTable",
  "rvltFlowTable",
  "rvltFlowFinancialSummary",
  "rvltFlowPageHeader",
  "rvltFlowPageFooter",
  "rvltFlowCheckbox",
  "rvltFlowSignatureLine",
  "rvltFlowCrewTable",
]);

export function isCustomPlugin(type: string): boolean {
  return CUSTOM_PLUGIN_TYPES.has(type);
}
