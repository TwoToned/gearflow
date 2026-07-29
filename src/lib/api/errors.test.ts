import { describe, test, expect } from "vitest";
import { ConvexError } from "convex/values";
import { ApiKeyAuthError } from "../api-key";
import { AgentTokenError } from "./agent-token";
import { KNOWN_ERROR_CODES, statusForError, toErrorEnvelope } from "./errors";

/**
 * The envelope is a MAPPING over codes the guards already throw, so the tests that
 * matter are the ones that would let a wrong mapping through silently:
 *
 *  • MISSING_SCOPE vs FORBIDDEN staying distinct (a conflated pair sends an agent
 *    to fix the wrong thing, and it would still look "handled");
 *  • `retryable` being honest (a false positive turns one bad call into a loop);
 *  • an unmapped throw degrading to a safe internal error rather than echoing an
 *    arbitrary message — this envelope goes to a third party.
 */

describe("MISSING_SCOPE and FORBIDDEN are never conflated", () => {
  test("MISSING_SCOPE is operator-fixable and names the scope", () => {
    const envelope = toErrorEnvelope(
      new ConvexError({
        code: "MISSING_SCOPE",
        message: "This API key is missing the 'project:manage_line_items' scope.",
        requiredScope: "project:manage_line_items",
      }),
    );
    expect(envelope.error.category).toBe("scope");
    expect(envelope.error.requiredScope).toBe("project:manage_line_items");
    expect(envelope.error.recovery?.action).toBe("grant_scope");
  });

  test("FORBIDDEN is NOT key-fixable and says so", () => {
    const envelope = toErrorEnvelope(new ConvexError("Forbidden: insufficient permissions."));
    expect(envelope.error.code).toBe("FORBIDDEN");
    expect(envelope.error.category).toBe("permission");
    expect(envelope.error.requiredScope).toBeNull();
    expect(envelope.error.recovery?.hint).toMatch(/widening the key will not help/i);
  });

  test("the two categories are different, which is the whole point", () => {
    const scope = toErrorEnvelope(
      new ConvexError({ code: "MISSING_SCOPE", message: "x", requiredScope: "asset:read" }),
    );
    const role = toErrorEnvelope(new ConvexError("Forbidden: insufficient permissions."));
    expect(scope.error.category).not.toBe(role.error.category);
    expect(scope.error.recovery?.action).not.toBe(role.error.recovery?.action);
  });
});

describe("the bare-string guards are translated, not lost", () => {
  test.each([
    ["Unauthorized: authentication required.", "UNAUTHORIZED"],
    ["Forbidden: organization mismatch.", "FORBIDDEN"],
    ["Forbidden: not a member of this organization.", "FORBIDDEN"],
    ["Line item already exists", "ALREADY_EXISTS"],
    ["myTable not found: abc", "NOT_FOUND"],
  ])("%s ⇒ %s", (message, code) => {
    expect(toErrorEnvelope(new ConvexError(message)).error.code).toBe(code);
  });
});

describe("gate codes map to the recovery an agent can actually act on", () => {
  test("FINANCIALS_LOCKED points at the unlock session and is NOT retryable", () => {
    const envelope = toErrorEnvelope(
      new ConvexError({ code: "FINANCIALS_LOCKED", message: "…", projectId: "p1", tier: "JUSTIFY" }),
    );
    expect(envelope.error.category).toBe("gate");
    expect(envelope.error.retryable).toBe(false);
    expect(envelope.error.recovery?.action).toBe("open_unlock_session");
    expect(envelope.error.details).toEqual({ projectId: "p1", tier: "JUSTIFY" });
  });

  test("JUSTIFICATION_REQUIRED IS retryable — the retry differs by one argument", () => {
    const envelope = toErrorEnvelope(new ConvexError({ code: "JUSTIFICATION_REQUIRED", message: "…" }));
    expect(envelope.error.retryable).toBe(true);
    expect(envelope.error.recovery?.action).toBe("retry_with_justification");
  });

  test("BULK_TOO_LARGE tells the agent to split rather than to wait", () => {
    const envelope = toErrorEnvelope(new ConvexError({ code: "BULK_TOO_LARGE", message: "…" }));
    expect(envelope.error.recovery?.action).toBe("split_batch");
    expect(envelope.error.recovery?.hint).toMatch(/50 items/);
  });

  test("the rate limiter's `kind` discriminator is recognised as a code", () => {
    // The rate-limit component names its discriminator `kind`, not `code`.
    const envelope = toErrorEnvelope(new ConvexError({ kind: "RateLimited", retryAfter: 1500 }));
    expect(envelope.error.code).toBe("RateLimited");
    expect(envelope.error.category).toBe("rate_limit");
    expect(envelope.error.retryable).toBe(true);
    expect(envelope.error.details).toEqual({ retryAfter: 1500 });
    expect(statusForError(new ConvexError({ kind: "RateLimited" }))).toBe(429);
  });
});

describe("credential errors", () => {
  test("ApiKeyAuthError carries its code and required scope through", () => {
    const envelope = toErrorEnvelope(
      new ApiKeyAuthError("MISSING_SCOPE", "too narrow", "asset:delete"),
    );
    expect(envelope.error.code).toBe("MISSING_SCOPE");
    expect(envelope.error.requiredScope).toBe("asset:delete");
  });

  test("a revoked key is a 401 that no retry will fix", () => {
    const error = new ApiKeyAuthError("KEY_INACTIVE", "revoked");
    expect(toErrorEnvelope(error).error.retryable).toBe(false);
    expect(statusForError(error)).toBe(401);
  });

  test("AgentTokenError is mapped too", () => {
    const envelope = toErrorEnvelope(new AgentTokenError("KEY_EXPIRED", "expired"));
    expect(envelope.error.code).toBe("KEY_EXPIRED");
    expect(envelope.error.category).toBe("auth");
  });
});

describe("unmapped throws degrade safely", () => {
  test("an unknown code is internal + non-retryable, never advertised as safe", () => {
    const envelope = toErrorEnvelope(new ConvexError({ code: "SOME_NEW_GUARD", message: "x" }));
    expect(envelope.error.category).toBe("internal");
    expect(envelope.error.retryable).toBe(false);
  });

  test("an internal error's message is FIXED — no stack, no query text, no other org's row", () => {
    const envelope = toErrorEnvelope(new Error("SELECT * FROM secrets WHERE org='org_B'"), {
      requestId: "req_abc",
    });
    expect(envelope.error.message).not.toMatch(/secrets|org_B/);
    expect(envelope.error.message).toMatch(/unexpected error/i);
    expect(envelope.error.requestId).toBe("req_abc");
  });

  test("a non-Error throw doesn't crash the envelope", () => {
    expect(() => toErrorEnvelope("just a string")).not.toThrow();
    expect(toErrorEnvelope(null).error.category).toBe("internal");
  });
});

describe("envelope shape", () => {
  test("every field of the documented contract is always present", () => {
    const envelope = toErrorEnvelope(new ConvexError({ code: "NOT_FOUND", message: "nope" }), {
      requestId: "req_1",
    });
    expect(Object.keys(envelope.error).sort()).toEqual([
      "category", "code", "details", "message", "recovery", "requestId", "requiredScope", "retryable",
    ]);
  });

  test("structural keys are not echoed back inside `details`", () => {
    const envelope = toErrorEnvelope(
      new ConvexError({ code: "MISSING_SCOPE", message: "m", requiredScope: "asset:read", assetId: "a1" }),
    );
    expect(envelope.error.details).toEqual({ assetId: "a1" });
  });

  test("the published code vocabulary is stable and sorted", () => {
    // `stable` operations promise an additive-only error vocabulary within /v1
    // (decision 12). This pins the current set so a REMOVAL shows up as a diff.
    expect(KNOWN_ERROR_CODES).toContain("FINANCIALS_LOCKED");
    expect(KNOWN_ERROR_CODES).toContain("MISSING_SCOPE");
    expect(KNOWN_ERROR_CODES).toContain("FORBIDDEN");
    expect([...KNOWN_ERROR_CODES]).toEqual([...KNOWN_ERROR_CODES].sort());
  });

  // Phase 4 (#1000)
  test("CONFIRMATION_REQUIRED is registered and retryable (re-send with confirm:true)", () => {
    expect(KNOWN_ERROR_CODES).toContain("CONFIRMATION_REQUIRED");
    const confirmation = toErrorEnvelope(Object.assign(new Error("m"), { code: "CONFIRMATION_REQUIRED" }));
    expect(confirmation.error.retryable).toBe(true); // re-send the SAME call with confirm:true
    expect(confirmation.error.recovery?.action).toBe("confirm_with_human");
  });
});
