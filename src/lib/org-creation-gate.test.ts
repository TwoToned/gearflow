/**
 * src/lib/org-creation-gate.ts — Phase B, B3 (#1095, D6). Covers the four
 * non-negotiable requirements from docs/designs/onboarding-and-activation.md
 * §5.3: server is the sole authority, constant-time comparison, rate limiting,
 * and (in site-admin.test.ts) that the code never reaches SiteSettingsRow.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const convexMock = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("@/lib/convex-client", () => ({
  getConvexClient: vi.fn(async () => convexMock),
  withConvexReadRetry: (fn: () => unknown) => fn(),
}));

import {
  getOrgCreationGateSettings,
  verifyOrgCreationCode,
  generateOrgCreationCode,
} from "./org-creation-gate";

beforeEach(() => {
  vi.clearAllMocks();
  convexMock.mutation.mockResolvedValue(undefined);
});

function mockSettingsDoc(doc: Record<string, unknown> | null) {
  convexMock.query.mockResolvedValue(doc);
}

describe("getOrgCreationGateSettings", () => {
  it("defaults to allowed, code disabled, no code when no row exists", async () => {
    mockSettingsDoc(null);
    await expect(getOrgCreationGateSettings()).resolves.toEqual({
      allowOrgCreation: true,
      codeEnabled: false,
      code: null,
    });
  });

  it("reads the raw code off the singleton doc", async () => {
    mockSettingsDoc({
      allowOrgCreation: true,
      orgCreationCodeEnabled: true,
      orgCreationCode: "abc123",
    });
    await expect(getOrgCreationGateSettings()).resolves.toEqual({
      allowOrgCreation: true,
      codeEnabled: true,
      code: "abc123",
    });
  });
});

describe("verifyOrgCreationCode", () => {
  it("rejects outright when allowOrgCreation is off, regardless of the code", async () => {
    mockSettingsDoc({ allowOrgCreation: false, orgCreationCodeEnabled: false });
    await expect(verifyOrgCreationCode(undefined, "user_1")).resolves.toBe(false);
    // Never even spends a rate-limit token for a toggle that's simply off.
    expect(convexMock.mutation).not.toHaveBeenCalled();
  });

  it("allows with no code required when the code toggle is off", async () => {
    mockSettingsDoc({ allowOrgCreation: true, orgCreationCodeEnabled: false });
    await expect(verifyOrgCreationCode(undefined, "user_1")).resolves.toBe(true);
  });

  it("rejects a missing code when a code is required", async () => {
    mockSettingsDoc({
      allowOrgCreation: true,
      orgCreationCodeEnabled: true,
      orgCreationCode: "correct-code",
    });
    await expect(verifyOrgCreationCode(undefined, "user_1")).resolves.toBe(false);
  });

  it("rejects a wrong code when a code is required", async () => {
    mockSettingsDoc({
      allowOrgCreation: true,
      orgCreationCodeEnabled: true,
      orgCreationCode: "correct-code",
    });
    await expect(verifyOrgCreationCode("wrong-code", "user_1")).resolves.toBe(false);
  });

  it("accepts the exact matching code", async () => {
    mockSettingsDoc({
      allowOrgCreation: true,
      orgCreationCodeEnabled: true,
      orgCreationCode: "correct-code",
    });
    await expect(verifyOrgCreationCode("correct-code", "user_1")).resolves.toBe(true);
  });

  it("accepts a code of different length than the stored one (no length-mismatch throw)", async () => {
    mockSettingsDoc({
      allowOrgCreation: true,
      orgCreationCodeEnabled: true,
      orgCreationCode: "correct-code",
    });
    await expect(verifyOrgCreationCode("short", "user_1")).resolves.toBe(false);
  });

  it("spends a rate-limit token keyed on the caller before comparing", async () => {
    mockSettingsDoc({
      allowOrgCreation: true,
      orgCreationCodeEnabled: true,
      orgCreationCode: "correct-code",
    });
    await verifyOrgCreationCode("correct-code", "user_42");
    expect(convexMock.mutation).toHaveBeenCalledWith(
      expect.anything(),
      { key: "user_42" },
    );
  });

  it("treats a rate-limit rejection the same as an invalid code", async () => {
    mockSettingsDoc({
      allowOrgCreation: true,
      orgCreationCodeEnabled: true,
      orgCreationCode: "correct-code",
    });
    convexMock.mutation.mockRejectedValue(new Error("RateLimited"));
    await expect(verifyOrgCreationCode("correct-code", "user_1")).resolves.toBe(false);
  });

  it("rejects when a code is required but none has ever been generated", async () => {
    mockSettingsDoc({ allowOrgCreation: true, orgCreationCodeEnabled: true });
    await expect(verifyOrgCreationCode("anything", "user_1")).resolves.toBe(false);
  });
});

describe("generateOrgCreationCode", () => {
  it("produces a fixed-length hex string, different each call", () => {
    const a = generateOrgCreationCode();
    const b = generateOrgCreationCode();
    expect(a).toMatch(/^[0-9a-f]{24}$/);
    expect(a).not.toBe(b);
  });
});
