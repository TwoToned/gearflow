import { describe, it, expect } from "vitest";
import { isOrgJoinPolicy, toOrgJoinPolicy, DEFAULT_ORG_JOIN_POLICY, ORG_JOIN_POLICIES } from "./org-join-policy";

describe("org-join-policy", () => {
  it("recognises every valid policy", () => {
    for (const p of ORG_JOIN_POLICIES) {
      expect(isOrgJoinPolicy(p)).toBe(true);
    }
  });

  it("rejects garbage", () => {
    expect(isOrgJoinPolicy("OPEN")).toBe(false);
    expect(isOrgJoinPolicy(undefined)).toBe(false);
    expect(isOrgJoinPolicy(null)).toBe(false);
    expect(isOrgJoinPolicy(42)).toBe(false);
  });

  it("defaults an absent/invalid value to INVITE_ONLY — every pre-B2 org", () => {
    expect(toOrgJoinPolicy(undefined)).toBe(DEFAULT_ORG_JOIN_POLICY);
    expect(toOrgJoinPolicy("garbage")).toBe(DEFAULT_ORG_JOIN_POLICY);
    expect(DEFAULT_ORG_JOIN_POLICY).toBe("INVITE_ONLY");
  });

  it("passes through a valid value unchanged", () => {
    expect(toOrgJoinPolicy("DOMAIN_REQUEST")).toBe("DOMAIN_REQUEST");
    expect(toOrgJoinPolicy("CLOSED")).toBe("CLOSED");
  });
});
