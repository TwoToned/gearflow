/**
 * src/lib/auth.ts's stripOrgCreationCode — the one-time signup code submitted
 * via `organization.create({ metadata: { orgCreationCode } })` must never be
 * persisted onto the created org's `metadata` (Phase B, B3/#1095). The rest of
 * the org-creation-gate wiring (allowUserToCreateOrganization,
 * beforeCreateOrganization) is exercised indirectly via
 * src/lib/org-creation-gate.test.ts (verifyOrgCreationCode) and
 * src/server/site-admin-org-creation-gate.test.ts (the shared bootstrap
 * predicate) — importing the full `betterAuth()` config here just to unit-test
 * this one pure helper would drag in the entire auth stack for no benefit.
 */
import { describe, it, expect } from "vitest";
import { stripOrgCreationCode } from "./auth";

describe("stripOrgCreationCode", () => {
  it("removes orgCreationCode and keeps other metadata keys", () => {
    expect(stripOrgCreationCode({ orgCreationCode: "secret", foo: "bar" })).toEqual({
      foo: "bar",
    });
  });

  it("returns undefined (not an empty object) when the code was the only key", () => {
    expect(stripOrgCreationCode({ orgCreationCode: "secret" })).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(stripOrgCreationCode(undefined)).toBeUndefined();
  });

  it("passes through metadata untouched when there was no code", () => {
    expect(stripOrgCreationCode({ foo: "bar" })).toEqual({ foo: "bar" });
  });
});
