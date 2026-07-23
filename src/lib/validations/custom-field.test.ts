/**
 * Unit tests for custom-field value validation (Wave 3).
 *
 * validateCustomFieldValues is the gate the asset create/update actions
 * run before persisting customFieldValues. Lock its behaviour:
 *   - required-field miss throws
 *   - unknown keys dropped
 *   - NUMBER / SELECT / BOOLEAN type checks
 *   - empty optional fields skipped, not stored as ""
 */

import { describe, it, expect } from "vitest";
import {
  validateCustomFieldValues,
  customFieldDefinitionSchema,
  customFieldDefinitionUpdateSchema,
  type CustomFieldDef,
} from "./custom-field";

const textReq: CustomFieldDef = {
  fieldKey: "rigNumber",
  label: "Rig Number",
  fieldType: "TEXT",
  options: [],
  required: true,
};
const numOpt: CustomFieldDef = {
  fieldKey: "channelCount",
  label: "Channels",
  fieldType: "NUMBER",
  options: [],
  required: false,
};
const selOpt: CustomFieldDef = {
  fieldKey: "caseColour",
  label: "Case Colour",
  fieldType: "SELECT",
  options: ["Black", "Silver"],
  required: false,
};
const boolOpt: CustomFieldDef = {
  fieldKey: "rackmount",
  label: "Rackmount",
  fieldType: "BOOLEAN",
  options: [],
  required: false,
};

describe("validateCustomFieldValues", () => {
  it("returns normalised values for valid input", () => {
    const out = validateCustomFieldValues(
      [textReq, numOpt, selOpt, boolOpt],
      {
        rigNumber: "R12",
        channelCount: "32",
        caseColour: "Black",
        rackmount: "true",
      },
    );
    expect(out).toEqual({
      rigNumber: "R12",
      channelCount: "32",
      caseColour: "Black",
      rackmount: "true",
    });
  });

  it("throws when a required field is missing", () => {
    expect(() => validateCustomFieldValues([textReq], {})).toThrow(/Rig Number.*required/);
    expect(() => validateCustomFieldValues([textReq], { rigNumber: "" })).toThrow(/required/);
  });

  it("skips empty optional fields rather than storing empty strings", () => {
    const out = validateCustomFieldValues([numOpt, selOpt], { channelCount: "" });
    expect(out).toEqual({});
  });

  it("drops keys with no matching definition", () => {
    const out = validateCustomFieldValues([textReq], {
      rigNumber: "R1",
      bogusKey: "ignored",
    });
    expect(out).toEqual({ rigNumber: "R1" });
  });

  it("rejects a non-numeric NUMBER value", () => {
    expect(() =>
      validateCustomFieldValues([numOpt], { channelCount: "lots" }),
    ).toThrow(/must be a number/);
  });

  it("rejects a SELECT value outside the option list", () => {
    expect(() =>
      validateCustomFieldValues([selOpt], { caseColour: "Gold" }),
    ).toThrow(/must be one of/);
  });

  it("rejects a non-boolean BOOLEAN value", () => {
    expect(() =>
      validateCustomFieldValues([boolOpt], { rackmount: "maybe" }),
    ).toThrow(/true or false/);
  });

  it("handles null / undefined raw input", () => {
    expect(validateCustomFieldValues([numOpt], null)).toEqual({});
    expect(validateCustomFieldValues([numOpt], undefined)).toEqual({});
  });
});

describe("customFieldDefinitionSchema", () => {
  it("accepts a valid TEXT definition", () => {
    const r = customFieldDefinitionSchema.safeParse({
      label: "Rig Number",
      fieldKey: "rigNumber",
      fieldType: "TEXT",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a fieldKey that doesn't start with a letter", () => {
    const r = customFieldDefinitionSchema.safeParse({
      label: "X",
      fieldKey: "2rig",
      fieldType: "TEXT",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a SELECT definition with no options", () => {
    const r = customFieldDefinitionSchema.safeParse({
      label: "Colour",
      fieldKey: "colour",
      fieldType: "SELECT",
      options: [],
    });
    expect(r.success).toBe(false);
  });

  it("accepts a SELECT definition with options", () => {
    const r = customFieldDefinitionSchema.safeParse({
      label: "Colour",
      fieldKey: "colour",
      fieldType: "SELECT",
      options: ["Red", "Blue"],
    });
    expect(r.success).toBe(true);
  });
});

// GitHub #747 — customFieldDefinitionUpdateSchema now derives from
// customFieldDefinitionSchema via `.omit({ entityType, fieldKey })` instead of
// re-declaring the label/options/helpText/sortOrder bounds. Lock the derived schema
// still enforces the same bounds and still omits the immutable fields.
describe("customFieldDefinitionUpdateSchema (derived via .omit from customFieldDefinitionSchema — #747)", () => {
  const validUpdate = {
    label: "Rig Number",
    fieldType: "TEXT" as const,
    options: [],
    required: false,
    sortOrder: 0,
    isActive: true,
  };

  it("accepts a valid update payload", () => {
    const r = customFieldDefinitionUpdateSchema.safeParse(validUpdate);
    expect(r.success).toBe(true);
  });

  it("does not require/accept entityType or fieldKey (immutable post-create)", () => {
    expect("entityType" in customFieldDefinitionUpdateSchema.shape).toBe(false);
    expect("fieldKey" in customFieldDefinitionUpdateSchema.shape).toBe(false);
  });

  it("rejects a label over the 60-char bound (mirrors the create schema)", () => {
    const r = customFieldDefinitionUpdateSchema.safeParse({ ...validUpdate, label: "x".repeat(61) });
    expect(r.success).toBe(false);
  });

  it("rejects an empty label", () => {
    const r = customFieldDefinitionUpdateSchema.safeParse({ ...validUpdate, label: "" });
    expect(r.success).toBe(false);
  });

  it("rejects help text over the 200-char bound", () => {
    const r = customFieldDefinitionUpdateSchema.safeParse({ ...validUpdate, helpText: "x".repeat(201) });
    expect(r.success).toBe(false);
  });

  it("rejects an option over the 80-char bound", () => {
    const r = customFieldDefinitionUpdateSchema.safeParse({
      ...validUpdate,
      fieldType: "SELECT",
      options: ["x".repeat(81)],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a SELECT definition with no options", () => {
    const r = customFieldDefinitionUpdateSchema.safeParse({ ...validUpdate, fieldType: "SELECT", options: [] });
    expect(r.success).toBe(false);
  });

  it("rejects a negative sortOrder", () => {
    const r = customFieldDefinitionUpdateSchema.safeParse({ ...validUpdate, sortOrder: -1 });
    expect(r.success).toBe(false);
  });
});
