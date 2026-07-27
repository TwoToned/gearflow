import { describe, it, expect } from "vitest";
import { gearflowPlugins, rvltFlowPlugins } from "./plugins";

/**
 * Rebrand aliases: every custom pdfme plugin is registered under both its legacy
 * `gearflow*` type name and the rebranded `rvltFlow*` name, so new/saved templates
 * can use the RVLT Flow type while existing (persisted `gearflow*`) templates keep
 * rendering. Guards the plugin registry (rendering lookup) sync point.
 */

const PLUGIN_SUFFIXES = [
  "Table",
  "FinancialSummary",
  "PageHeader",
  "PageFooter",
  "Checkbox",
  "SignatureLine",
  "CrewTable",
  "CallSheetInfo",
  "DayHeader",
  "RichText",
  "DataTable",
  "SummaryBox",
  "TextBlock",
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
});
