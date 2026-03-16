/**
 * Resolves {variable} tokens in pdfme template schemas.
 * Walks all schemas, finds text fields with {token_name} patterns,
 * and replaces them with values from DocumentData.
 */
import type { Template, Schema } from "@pdfme/common";
import type { DocumentData } from "./types";

const TOKEN_REGEX = /\{([a-z_][a-z0-9_]*)\}/gi;

/**
 * Resolve all {variable} tokens in a template's schema content fields.
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
  // Build flat token map from data (only string/number primitives)
  const tokenMap: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") {
      tokenMap[key] = value;
    } else if (typeof value === "number") {
      tokenMap[key] = String(value);
    }
    // Arrays/objects (line_items, crew, org_branding) are not flat tokens
  }

  // Build inputs array — one record per page in the schemas array
  const inputs: Record<string, string>[] = [];

  for (const pageSchemas of template.schemas) {
    const pageInputs: Record<string, string> = {};

    for (const schema of pageSchemas) {
      const s = schema as Schema & Record<string, unknown>;
      const name = s.name;
      const content = s.content || "";

      // Check if this is a custom plugin that expects JSON data
      if (isCustomPlugin(s.type)) {
        // Custom plugins get their data injected by the template builder,
        // not through token resolution. Leave content as-is.
        pageInputs[name] = content;
      } else {
        // Standard text/etc fields — resolve {tokens}
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
  return text.replace(TOKEN_REGEX, (match, tokenName) => {
    const key = tokenName.toLowerCase();
    return tokenMap[key] !== undefined ? tokenMap[key] : match;
  });
}

/** Custom plugin types that receive JSON data, not token-resolved text */
const CUSTOM_PLUGIN_TYPES = new Set([
  "gearflowTable",
  "gearflowFinancialSummary",
  "gearflowPageHeader",
  "gearflowPageFooter",
  "gearflowCheckbox",
  "gearflowSignatureLine",
  "gearflowCrewTable",
]);

function isCustomPlugin(type: string): boolean {
  return CUSTOM_PLUGIN_TYPES.has(type);
}
