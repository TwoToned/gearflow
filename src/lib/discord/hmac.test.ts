import { describe, expect, it } from "vitest";
import { signDiscordRequest, verifyDiscordRequest } from "./hmac";

const SECRET = "test-signing-secret";

describe("discord hmac", () => {
  const body = JSON.stringify({ assetCode: "TTP-042", severity: "MAJOR" });
  const now = 1_780_000_000;

  it("verifies a correctly signed request", () => {
    const sig = signDiscordRequest(body, now, SECRET);
    expect(verifyDiscordRequest(body, sig, String(now), SECRET, now)).toEqual({ valid: true });
  });

  it("rejects a tampered body", () => {
    const sig = signDiscordRequest(body, now, SECRET);
    const res = verifyDiscordRequest(body + "x", sig, String(now), SECRET, now);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe("mismatch");
  });

  it("rejects the wrong secret", () => {
    const sig = signDiscordRequest(body, now, SECRET);
    expect(verifyDiscordRequest(body, sig, String(now), "other", now).valid).toBe(false);
  });

  it("does NOT throw on a malformed/short signature (length mismatch)", () => {
    expect(() => verifyDiscordRequest(body, "abc", String(now), SECRET, now)).not.toThrow();
    expect(verifyDiscordRequest(body, "abc", String(now), SECRET, now)).toEqual({
      valid: false,
      reason: "mismatch",
    });
  });

  it("rejects a stale timestamp (replay window)", () => {
    const sig = signDiscordRequest(body, now, SECRET);
    const res = verifyDiscordRequest(body, sig, String(now), SECRET, now + 400);
    expect(res).toEqual({ valid: false, reason: "stale" });
  });

  it("rejects missing signature or timestamp", () => {
    expect(verifyDiscordRequest(body, null, String(now), SECRET, now).reason).toBe("missing");
    expect(verifyDiscordRequest(body, "x", null, SECRET, now).reason).toBe("missing");
  });
});
