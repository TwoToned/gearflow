/**
 * Unit tests for the Prisma → UserFacingError translator.
 *
 * Each Prisma error code maps to a specific shape; if we change the mapping,
 * 340 callsites of toast.error visibly change. Lock the mapping with tests.
 */

import { describe, it, expect } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { translatePrismaError } from "./prisma-translator";

function p2002(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "Unique constraint failed",
    { code: "P2002", clientVersion: "x", meta: { target } },
  );
}

describe("translatePrismaError", () => {
  it("translates P2002 unique violation to DUPLICATE", () => {
    const out = translatePrismaError(p2002(["assetTag"]));
    expect(out).not.toBeNull();
    expect(out!.code).toBe("DUPLICATE");
    expect(out!.title).toBe("Duplicate asset tag");
    expect(out!.message).toContain("asset tag");
    expect(out!.field).toBe("assetTag");
  });

  it("translates P2002 with composite key", () => {
    const out = translatePrismaError(p2002(["organizationId", "name"]));
    expect(out!.title).toBe("Duplicate organization id + name");
  });

  it("translates P2002 with unknown field via humanize", () => {
    const out = translatePrismaError(p2002(["frobnicatorRef"]));
    // Falls back to splitting camelCase, lowercasing.
    expect(out!.title).toBe("Duplicate frobnicator ref");
  });

  it("translates P2003 FK violation to FK_CONSTRAINT", () => {
    const err = new Prisma.PrismaClientKnownRequestError(
      "Foreign key constraint failed",
      { code: "P2003", clientVersion: "x", meta: { field_name: "supplier_id" } },
    );
    const out = translatePrismaError(err);
    expect(out!.code).toBe("FK_CONSTRAINT");
    expect(out!.title).toBe("Cannot complete this change");
    expect(out!.message).toContain("references");
  });

  it("translates P2025 not found with default friendly message", () => {
    const err = new Prisma.PrismaClientKnownRequestError(
      "Record to update not found",
      {
        code: "P2025",
        clientVersion: "x",
        meta: { cause: "Record to update not found." },
      },
    );
    const out = translatePrismaError(err);
    expect(out!.code).toBe("NOT_FOUND");
    expect(out!.message).toMatch(/refresh the page/i);
  });

  it("translates P2025 with custom cause string", () => {
    const err = new Prisma.PrismaClientKnownRequestError(
      "Custom cause",
      {
        code: "P2025",
        clientVersion: "x",
        meta: { cause: "An operation failed because it depends on one or more records that were required but not found." },
      },
    );
    const out = translatePrismaError(err);
    expect(out!.code).toBe("NOT_FOUND");
    // Uses the custom cause verbatim since it's not the default delete/update string.
    expect(out!.message).toContain("operation failed");
  });

  it("translates P2014 relation violation to RELATION_VIOLATION", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Relation violation", {
      code: "P2014",
      clientVersion: "x",
    });
    const out = translatePrismaError(err);
    expect(out!.code).toBe("RELATION_VIOLATION");
    expect(out!.title).toBe("Cannot remove");
  });

  it("returns null for unknown Prisma codes", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Other error", {
      code: "P9999",
      clientVersion: "x",
    });
    expect(translatePrismaError(err)).toBeNull();
  });

  it("returns null for non-Prisma errors", () => {
    expect(translatePrismaError(new Error("not prisma"))).toBeNull();
    expect(translatePrismaError("string error")).toBeNull();
    expect(translatePrismaError(null)).toBeNull();
    expect(translatePrismaError(undefined)).toBeNull();
  });
});
