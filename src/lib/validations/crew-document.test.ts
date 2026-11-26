import { describe, expect, test } from "vitest";
import { crewDocumentSchema } from "./crew-document";

// The Zod form mirrors the bounds `convex/crewDocumentsWrites.ts` enforces (1970 to the end of 2099).
describe("crewDocumentSchema", () => {
  const parse = (expiry?: string) => crewDocumentSchema.safeParse({ kind: "LICENCE", ...(expiry === undefined ? {} : { expiry }) });

  test("accepts no expiry, a blank one and an in-range date", () => {
    for (const ok of [undefined, "", "1970-01-01", "2030-06-30", "2099-12-31"]) expect(parse(ok).success, String(ok)).toBe(true);
  });

  test("rejects a date outside 1970..2099 and a malformed or impossible one", () => {
    for (const bad of ["1969-12-31", "2100-01-01", "9999-12-31", "2030-13-40", "30-06-2030"]) expect(parse(bad).success, bad).toBe(false);
  });

  test("a name is capped at 200 characters", () => {
    expect(crewDocumentSchema.safeParse({ kind: "ID", name: "x".repeat(200) }).success).toBe(true);
    expect(crewDocumentSchema.safeParse({ kind: "ID", name: "x".repeat(201) }).success).toBe(false);
  });
});
