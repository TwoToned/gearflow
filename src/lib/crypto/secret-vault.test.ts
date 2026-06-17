import { describe, it, expect, beforeEach } from "vitest";
import {
  _resetSecretVaultCache,
  decryptSecret,
  encryptSecret,
  isEncrypted,
  SecretVaultError,
} from "./secret-vault";

describe("secret-vault", () => {
  beforeEach(() => _resetSecretVaultCache());

  it("round-trips an arbitrary secret string", () => {
    // Intentionally NOT shaped like a real API token (the GitHub secret
    // scanner is fooled by anything resembling one, even in tests).
    const secret = "test-secret-round-trip-not-a-token";
    const c = encryptSecret(secret);
    expect(c).toMatch(/^v1:/);
    expect(c).not.toContain(secret);
    expect(decryptSecret(c)).toBe(secret);
  });

  it("preserves empty input as empty output (admin clears the field)", () => {
    expect(encryptSecret("")).toBe("");
    expect(decryptSecret("")).toBe("");
  });

  it("produces a different ciphertext every time (fresh IV)", () => {
    const a = encryptSecret("same plaintext");
    const b = encryptSecret("same plaintext");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it("detects a tampered ciphertext (GCM auth tag)", () => {
    const c = encryptSecret("supersecret");
    const parts = c.slice("v1:".length).split(".");
    const ivB64 = parts[0]!;
    const ctB64 = parts[1]!;
    const tagB64 = parts[2]!;
    // Flip a bit in the ciphertext body.
    const ctBytes = Buffer.from(ctB64, "base64");
    ctBytes[0] = ctBytes[0]! ^ 1;
    const tampered = `v1:${ivB64}.${ctBytes.toString("base64")}.${tagB64}`;
    expect(() => decryptSecret(tampered)).toThrow(SecretVaultError);
  });

  it("rejects an unknown format prefix", () => {
    expect(() => decryptSecret("v0:foo.bar.baz")).toThrow(/v1:/);
  });

  it("rejects malformed payloads (wrong segment count)", () => {
    expect(() => decryptSecret("v1:only.two")).toThrow(SecretVaultError);
  });

  it("rejects iv/tag of the wrong length", () => {
    expect(() => decryptSecret("v1:AAA.BBB.CCC")).toThrow(SecretVaultError);
  });

  it("isEncrypted matches the storage prefix without attempting to decrypt", () => {
    expect(isEncrypted("v1:anything.here.atall")).toBe(true);
    expect(isEncrypted("plain text")).toBe(false);
    expect(isEncrypted(null)).toBe(false);
    expect(isEncrypted(undefined)).toBe(false);
  });
});
