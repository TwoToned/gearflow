// @vitest-environment node
import crypto from "crypto";
import { describe, expect, it } from "vitest";

import { signForPurpose, verifyForPurpose } from "@/lib/hmac-purpose";
import { createTeamUndoToken, verifyTeamUndoToken } from "@/lib/team-undo-token";
import { createXeroOAuthState, verifyXeroOAuthState } from "@/lib/xero-oauth-state";
import { env } from "@/env";

describe("each layer of the purpose separation is pinned on its own", () => {
  const P = "team-undo:v1";
  const Q = "xero-oauth-state:v1";
  const derive = (info: string) => Buffer.from(crypto.hkdfSync("sha256", env.BETTER_AUTH_SECRET, Buffer.alloc(0), info, 32));
  const mac = (key: Buffer | string, input: string) => crypto.createHmac("sha256", key).update(input).digest("base64url");

  it("the construction is exactly HKDF(secret, info=purpose) keying HMAC over `purpose:payload`", () => {
    expect(signForPurpose(P, "x")).toBe(mac(derive(P), `${P}:x`));
  });

  it("KEY layer: the right MAC input under a DIFFERENT derived key (or the raw secret) does not verify", () => {
    expect(verifyForPurpose(P, "x", mac(derive(Q), `${P}:x`))).toBe(false);
    expect(verifyForPurpose(P, "x", mac(env.BETTER_AUTH_SECRET, `${P}:x`))).toBe(false);
    expect(signForPurpose(P, "x")).not.toBe(mac(env.BETTER_AUTH_SECRET, `${P}:x`));
  });

  it("MAC-input layer: the SAME key over a different purpose string, or none, does not verify", () => {
    expect(verifyForPurpose(P, "x", mac(derive(P), `${Q}:x`))).toBe(false);
    expect(verifyForPurpose(P, "x", mac(derive(P), "x"))).toBe(false);
  });
});

describe("purpose-separated HMAC", () => {
  it("the same payload signs differently for different purposes, and each verifies only for its own", () => {
    const a = signForPurpose("team-undo:v1", "payload");
    const b = signForPurpose("xero-oauth-state:v1", "payload");
    expect(a).not.toBe(b);
    expect(verifyForPurpose("team-undo:v1", "payload", a)).toBe(true);
    expect(verifyForPurpose("xero-oauth-state:v1", "payload", a)).toBe(false);
    expect(verifyForPurpose("team-undo:v1", "payload", b)).toBe(false);
    expect(verifyForPurpose("team-undo:v1", "payload2", a)).toBe(false);
  });

  it("a team Undo token can't be replayed as a Xero state, and a Xero state can't be replayed as an Undo", () => {
    const team = createTeamUndoToken({ orgId: "o", actorId: "u", body: { kind: "role", items: [{ memberId: "m", from: "manager", to: "viewer" }] } });
    expect(() => verifyXeroOAuthState(team.token)).toThrow();
    const xero = createXeroOAuthState("o", "u");
    expect(() => verifyTeamUndoToken(xero)).toThrow();
    // Even re-signing a Xero-shaped payload with the team purpose is refused by the Xero verifier.
    const encoded = Buffer.from(JSON.stringify({ orgId: "o", userId: "u", nonce: "n", iat: Date.now() })).toString("base64url");
    expect(() => verifyXeroOAuthState(`${encoded}.${signForPurpose("team-undo:v1", encoded)}`)).toThrow();
  });

  it("a Xero state issued before this change (raw-secret MAC) still verifies for its 10-minute life", () => {
    const encoded = Buffer.from(JSON.stringify({ orgId: "org_1", userId: "user_1", nonce: "n", iat: Date.now() })).toString("base64url");
    const legacy = crypto.createHmac("sha256", env.BETTER_AUTH_SECRET).update(encoded).digest("base64url");
    expect(verifyXeroOAuthState(`${encoded}.${legacy}`)).toEqual({ orgId: "org_1", userId: "user_1" });
  });

  it("the legacy raw-secret form is NOT accepted for a team Undo token", () => {
    const team = createTeamUndoToken({ orgId: "o", actorId: "u", body: { kind: "role", items: [{ memberId: "m", from: "manager", to: "viewer" }] } });
    const [encoded] = team.token.split(".");
    const legacy = crypto.createHmac("sha256", env.BETTER_AUTH_SECRET).update(encoded).digest("base64url");
    expect(() => verifyTeamUndoToken(`${encoded}.${legacy}`)).toThrow();
  });
});
