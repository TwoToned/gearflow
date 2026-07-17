import { describe, it, expect } from "vitest";
import { gearflowPlugins, rvltFlowPlugins } from "./plugins";
import { isCustomPlugin } from "./token-resolver";

/**
 * Rebrand aliases: every custom pdfme plugin is registered under both its legacy
 * `gearflow*` type name and the rebranded `rvltFlow*` name, so new/saved templates
 * can use the RVLT Flow type while existing (persisted `gearflow*`) templates keep
 * rendering. Guards the two sync points that route by type string: the plugin
 * registry (rendering lookup) and CUSTOM_PLUGIN_TYPES (JSON-vs-text routing).
 */

const PLUGIN_SUFFIXES = [
  "Rect",
  "Table",
  "FinancialSummary",
  "PageHeader",
  "PageFooter",
  "Checkbox",
  "SignatureLine",
  "CrewTable",
  "CallSheetInfo",
  "DayHeader",
  "DataTable",
  "SummaryBox",
  "TextBlock",
] as const;

// The subset that receives JSON payloads (mirrors CUSTOM_PLUGIN_TYPES).
const CUSTOM_SUFFIXES = [
  "Table",
  "FinancialSummary",
  "PageHeader",
  "PageFooter",
  "Checkbox",
  "SignatureLine",
  "CrewTable",
] as const;

describe("rebrand plugin aliases", () => {
  it("rvltFlowPlugins is the same registry object as gearflowPlugins", () => {
    expect(rvltFlowPlugins).toBe(gearflowPlugins);
  });

  it("every plugin resolves identically under both the legacy and rebranded key", () => {
    const registry = gearflowPlugins as Record<string, unknown>;
    for (const suffix of PLUGIN_SUFFIXES) {
      const legacy = registry[`gearflow${suffix}`];
      const rebranded = registry[`rvltFlow${suffix}`];
      expect(legacy, `gearflow${suffix} missing`).toBeDefined();
      expect(rebranded, `rvltFlow${suffix} missing`).toBeDefined();
      expect(rebranded).toBe(legacy);
    }
  });

  it("routes both legacy and rebranded custom types to JSON, not token text", () => {
    for (const suffix of CUSTOM_SUFFIXES) {
      expect(isCustomPlugin(`gearflow${suffix}`)).toBe(true);
      expect(isCustomPlugin(`rvltFlow${suffix}`)).toBe(true);
    }
    // Plain text is still token-resolved, not treated as a custom plugin.
    expect(isCustomPlugin("text")).toBe(false);
  });
});
