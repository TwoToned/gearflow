// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const h = vi.hoisted(() => ({
  activeOrgData: { id: "org_1" } as { id: string } | undefined,
  orgData: undefined as { settings: Record<string, unknown> } | undefined,
}));

vi.mock("@/lib/auth-client", () => ({
  useActiveOrganization: () => ({ data: h.activeOrgData }),
}));

vi.mock("@/hooks/use-organization", () => ({
  useOrganization: () => ({ data: h.orgData }),
}));

import { useOrgCountry, useOrgWeekStartsOn } from "./use-org-country";

describe("useOrgCountry", () => {
  it("returns the org's configured country code", () => {
    h.orgData = { settings: { country: "GB" } };
    const { result } = renderHook(() => useOrgCountry());
    expect(result.current).toBe("GB");
  });

  it("returns undefined when no country is set", () => {
    h.orgData = { settings: {} };
    const { result } = renderHook(() => useOrgCountry());
    expect(result.current).toBeUndefined();
  });
});

describe("useOrgWeekStartsOn (I6, #1086)", () => {
  it("defaults to Monday (1) when no country is set", () => {
    h.orgData = { settings: {} };
    const { result } = renderHook(() => useOrgWeekStartsOn());
    expect(result.current).toBe(1);
  });

  it("US is the only launch market that starts Sunday (0)", () => {
    h.orgData = { settings: { country: "US" } };
    const { result } = renderHook(() => useOrgWeekStartsOn());
    expect(result.current).toBe(0);
  });

  it("every other launch market starts Monday (1)", () => {
    for (const country of ["AU", "NZ", "GB", "IE"]) {
      h.orgData = { settings: { country } };
      const { result } = renderHook(() => useOrgWeekStartsOn());
      expect(result.current).toBe(1);
    }
  });

  it("an unknown country code falls back to Monday, never guesses Sunday", () => {
    h.orgData = { settings: { country: "ZZ" } };
    const { result } = renderHook(() => useOrgWeekStartsOn());
    expect(result.current).toBe(1);
  });
});
