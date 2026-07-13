// @vitest-environment node
import { describe, test, expect } from "vitest";
import schema from "./schema";
import {
  CLASSIFIED_TABLES,
  EXPORTED_TABLES,
  EXCLUDED_TABLES,
  EXPECTED_TABLE_COUNT,
  assertClassificationIntegrity,
  assertCoverage,
} from "../scripts/org-export-tables";

// The live table set, straight from the compiled schema (not a hand-copied list).
const SCHEMA_TABLES = Object.keys(schema.tables);

describe("org export coverage", () => {
  test("schema has the expected number of tables", () => {
    expect(SCHEMA_TABLES.length).toBe(EXPECTED_TABLE_COUNT);
  });

  test("classification is internally consistent (no dupes, correct total)", () => {
    expect(() => assertClassificationIntegrity()).not.toThrow();
    expect(new Set(CLASSIFIED_TABLES).size).toBe(EXPECTED_TABLE_COUNT);
  });

  test("classified set exactly equals the schema table set", () => {
    const classified = new Set(CLASSIFIED_TABLES);
    const schemaSet = new Set(SCHEMA_TABLES);

    const unclassified = SCHEMA_TABLES.filter((t) => !classified.has(t));
    const phantom = CLASSIFIED_TABLES.filter((t) => !schemaSet.has(t));

    // Precise failure messages so a future new table points at the fix.
    expect(unclassified, `Unclassified schema tables: ${unclassified.join(", ")}`).toEqual([]);
    expect(phantom, `Classified but not in schema: ${phantom.join(", ")}`).toEqual([]);
  });

  test("assertCoverage passes against the real schema", () => {
    expect(() => assertCoverage(SCHEMA_TABLES)).not.toThrow();
  });

  test("assertCoverage FAILS when the schema grows an unclassified table", () => {
    expect(() => assertCoverage([...SCHEMA_TABLES, "someBrandNewTable"])).toThrow(
      /Unclassified schema table/,
    );
  });

  test("exported ∪ excluded partition (no table both exported and excluded)", () => {
    const exported = new Set(EXPORTED_TABLES);
    const overlap = EXCLUDED_TABLES.filter((t) => exported.has(t));
    expect(overlap, `Tables in both exported and excluded: ${overlap.join(", ")}`).toEqual([]);
  });
});
