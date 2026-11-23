// @vitest-environment node
//
// Review SF6: `testCard`'s redaction asks the caller's OWN read guard again for
// `project` and `warehouse`. Only a missing API-key scope means "leave it out"; any
// other refusal (an unauthenticated caller, a lost membership) must still throw, never
// quietly degrade to a redacted card.
import { ConvexError } from "convex/values";
import { describe, expect, test, vi, beforeEach } from "vitest";

const guard = vi.hoisted(() => ({ requireOrgReadFor: vi.fn() }));
vi.mock("./auth", () => guard);

import { redactForTestTagOnly, type ScanCard } from "./scanCard";

const card = {
  kind: "asset", tag: "A-1", job: { projectId: "p1" }, location: { id: "l1", name: "Shelf" },
  lastCheck: { at: 1 }, checkItemCount: 3,
} as unknown as ScanCard;
const ctx = {} as never;

beforeEach(() => {
  guard.requireOrgReadFor.mockReset();
});

describe("redactForTestTagOnly / canAlsoRead", () => {
  test("a missing key scope leaves that resource's facts out", async () => {
    guard.requireOrgReadFor.mockImplementation(async (_c: unknown, _o: string, r: string) => {
      if (r === "warehouse") throw new ConvexError({ code: "MISSING_SCOPE", message: "no" });
    });
    const out = await redactForTestTagOnly(ctx, "org_1", card);
    expect(out.job).toEqual(card.job);
    expect(out.location).toBeNull();
    expect(out.lastCheck).toBeNull();
    expect(out.checkItemCount).toBe(0);
  });

  test("any other refusal is rethrown, not turned into a redacted card", async () => {
    const refuse = (e: Error) => guard.requireOrgReadFor.mockImplementation(async () => {
      throw e;
    });
    const forbidden = new ConvexError({ code: "FORBIDDEN", message: "Not a member" });
    refuse(forbidden);
    await expect(redactForTestTagOnly(ctx, "org_1", card)).rejects.toBe(forbidden);
    const unauth = new ConvexError("Unauthenticated");
    refuse(unauth);
    await expect(redactForTestTagOnly(ctx, "org_1", card)).rejects.toBe(unauth);
    const plain = new Error("boom");
    refuse(plain);
    await expect(redactForTestTagOnly(ctx, "org_1", card)).rejects.toBe(plain);
  });
});
