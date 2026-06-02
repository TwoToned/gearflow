/**
 * Tests for resolveTemplateSettings — the read-time merge that ensures
 * legacy stored DocumentTemplate.settings JSON picks up safe defaults
 * for keys added in later releases (the most critical failure mode the
 * Phase 1 engineering review flagged).
 */
import { describe, it, expect } from "vitest";
import {
  getDefaultSettings,
  resolveTemplateSettings,
} from "./template-settings";

describe("resolveTemplateSettings", () => {
  it("returns docType defaults when stored is null", () => {
    const result = resolveTemplateSettings("packing-list", null);
    expect(result).toEqual(getDefaultSettings("packing-list"));
  });

  it("returns docType defaults when stored is undefined", () => {
    const result = resolveTemplateSettings("packing-list", undefined);
    expect(result).toEqual(getDefaultSettings("packing-list"));
  });

  it("returns docType defaults when stored JSON string is malformed", () => {
    const result = resolveTemplateSettings("packing-list", "{not valid json");
    expect(result).toEqual(getDefaultSettings("packing-list"));
  });

  it("parses a JSON string and merges with defaults", () => {
    const stored = JSON.stringify({
      header: { documentTitle: "CUSTOM TITLE" },
    });
    const result = resolveTemplateSettings("quote", stored);
    expect(result.header.documentTitle).toBe("CUSTOM TITLE");
    // Other header keys fall back to defaults
    expect(result.header.logoMode).toBe("icon");
  });

  it("a partial object with no `table` field still gets the table defaults", () => {
    // This is the critical failure-mode case from the eng review: legacy
    // template JSON predates the `expandProjectGroups` key entirely.
    // Without the merge, `settings.table.expandProjectGroups` reads
    // `undefined` and falls through to collapsed-row behaviour — every
    // existing org's packing list silently regresses.
    const legacyStored: Record<string, unknown> = {
      header: { documentTitle: "PULL SLIP" },
      footer: { showFooter: true },
      // No `table` key at all.
    };
    const result = resolveTemplateSettings("packing-list", legacyStored);
    expect(result.table.expandProjectGroups).toBe(true);
    expect(result.table.showCheckboxes).toBe(true); // packing-list default
    expect(result.table.showPerUnitCheckboxes).toBe(true);
  });

  it("a `table` object missing the new key picks up the default", () => {
    // Even when `table` exists on stored settings, any keys missing from
    // that nested object also need defaults.
    const stored: Record<string, unknown> = {
      table: {
        showGroupHeaders: false, // user explicitly customized
        // expandProjectGroups missing — defaults to docType value
      },
    };
    const result = resolveTemplateSettings("packing-list", stored);
    expect(result.table.showGroupHeaders).toBe(false); // user wins
    expect(result.table.expandProjectGroups).toBe(true); // default wins
  });

  it("stored values always win over defaults when present", () => {
    const stored: Record<string, unknown> = {
      table: { expandProjectGroups: false }, // user opted out
    };
    const result = resolveTemplateSettings("packing-list", stored);
    expect(result.table.expandProjectGroups).toBe(false);
  });

  it("defaults differ per docType for expandProjectGroups", () => {
    expect(resolveTemplateSettings("packing-list", null).table.expandProjectGroups).toBe(true);
    expect(resolveTemplateSettings("return-sheet", null).table.expandProjectGroups).toBe(true);
    expect(resolveTemplateSettings("delivery-docket", null).table.expandProjectGroups).toBe(true);
    expect(resolveTemplateSettings("quote", null).table.expandProjectGroups).toBe(false);
    expect(resolveTemplateSettings("invoice", null).table.expandProjectGroups).toBe(false);
    expect(resolveTemplateSettings("call-sheet", null).table.expandProjectGroups).toBe(false);
  });

  it("merge does not mutate the docType defaults source", () => {
    const beforeDefaults = getDefaultSettings("packing-list");
    const beforeExpand = beforeDefaults.table.expandProjectGroups;
    resolveTemplateSettings("packing-list", {
      table: { expandProjectGroups: false },
    });
    const afterDefaults = getDefaultSettings("packing-list");
    expect(afterDefaults.table.expandProjectGroups).toBe(beforeExpand);
  });
});
