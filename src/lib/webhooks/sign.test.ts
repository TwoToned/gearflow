import { describe, it, expect } from "vitest";
import {
  generateWebhookSecret,
  signWebhookPayload,
  parseSignatureHeader,
  verifyWebhookSignature,
  SIGNATURE_TOLERANCE_SECONDS,
} from "./sign";

const BODY = '{"id":"whd_1","event":"project.status_changed"}';
const SECRET = "whsec_test_secret";
const NOW = 1_783_600_000;

describe("generateWebhookSecret", () => {
  it("is prefixed and unique", () => {
    const a = generateWebhookSecret();
    expect(a.startsWith("whsec_")).toBe(true);
    expect(generateWebhookSecret()).not.toBe(a);
  });
});

describe("parseSignatureHeader", () => {
  it("parses t and v1", () => {
    expect(parseSignatureHeader("t=123,v1=abc")).toEqual({ t: 123, v1: ["abc"] });
  });
  it("collects every v1 — a rotation-window delivery carries two", () => {
    expect(parseSignatureHeader("t=123,v1=abc,v1=def")).toEqual({ t: 123, v1: ["abc", "def"] });
  });
  it("tolerates whitespace, extra parts and reordering", () => {
    expect(parseSignatureHeader("v1=abc, t=123 , v0=ignored")).toEqual({ t: 123, v1: ["abc"] });
  });
  it("does not truncate a value containing '='", () => {
    expect(parseSignatureHeader("t=123,v1=ab=cd")!.v1).toEqual(["ab=cd"]);
  });
  it("rejects malformed input", () => {
    expect(parseSignatureHeader("garbage")).toBeNull();
    expect(parseSignatureHeader("t=notanumber,v1=abc")).toBeNull();
    expect(parseSignatureHeader("t=123")).toBeNull();
  });
});

describe("verifyWebhookSignature", () => {
  const header = () => signWebhookPayload(BODY, SECRET, NOW);

  it("accepts a signature it just produced", () => {
    expect(
      verifyWebhookSignature({ rawBody: BODY, header: header(), secrets: [SECRET], nowSeconds: NOW }),
    ).toEqual({ valid: true });
  });

  it("rejects a tampered body", () => {
    const res = verifyWebhookSignature({
      rawBody: BODY.replace("whd_1", "whd_2"),
      header: header(),
      secrets: [SECRET],
      nowSeconds: NOW,
    });
    expect(res).toEqual({ valid: false, reason: "mismatch" });
  });

  it("rejects the wrong secret", () => {
    expect(
      verifyWebhookSignature({ rawBody: BODY, header: header(), secrets: ["whsec_other"], nowSeconds: NOW }),
    ).toEqual({ valid: false, reason: "mismatch" });
  });

  it("REJECTS A REPLAY: an old, validly-signed body outside the tolerance window", () => {
    // This is why the timestamp is signed rather than merely sent alongside.
    const captured = signWebhookPayload(BODY, SECRET, NOW);
    const later = NOW + SIGNATURE_TOLERANCE_SECONDS + 1;
    expect(
      verifyWebhookSignature({ rawBody: BODY, header: captured, secrets: [SECRET], nowSeconds: later }),
    ).toEqual({ valid: false, reason: "expired" });
  });

  it("cannot be replayed by moving the timestamp forward — that breaks the HMAC", () => {
    const captured = parseSignatureHeader(signWebhookPayload(BODY, SECRET, NOW))!;
    const forged = `t=${NOW + 10},v1=${captured.v1[0]}`;
    expect(
      verifyWebhookSignature({ rawBody: BODY, header: forged, secrets: [SECRET], nowSeconds: NOW + 10 }),
    ).toEqual({ valid: false, reason: "mismatch" });
  });

  it("accepts a timestamp slightly in the future (clock skew)", () => {
    const skewed = signWebhookPayload(BODY, SECRET, NOW + 60);
    expect(
      verifyWebhookSignature({ rawBody: BODY, header: skewed, secrets: [SECRET], nowSeconds: NOW }),
    ).toEqual({ valid: true });
  });

  it("signs with BOTH secrets during a rotation window, so an un-rotated consumer still verifies", () => {
    // The whole point of the grace window. Signing only with the new secret would
    // break every consumer the instant the operator rotated.
    const header = signWebhookPayload(BODY, ["whsec_new", "whsec_old"], NOW);
    expect(header.match(/v1=/g)).toHaveLength(2);

    // A consumer still holding only the OLD secret verifies.
    expect(verifyWebhookSignature({ rawBody: BODY, header, secrets: ["whsec_old"], nowSeconds: NOW })).toEqual({ valid: true });
    // A consumer that already swapped to the NEW secret verifies.
    expect(verifyWebhookSignature({ rawBody: BODY, header, secrets: ["whsec_new"], nowSeconds: NOW })).toEqual({ valid: true });
    // An unrelated secret still does not.
    expect(verifyWebhookSignature({ rawBody: BODY, header, secrets: ["whsec_other"], nowSeconds: NOW }).valid).toBe(false);
  });

  it("rejects a missing or malformed header", () => {
    expect(verifyWebhookSignature({ rawBody: BODY, header: null, secrets: [SECRET] })).toEqual({
      valid: false,
      reason: "malformed",
    });
    expect(verifyWebhookSignature({ rawBody: BODY, header: "nope", secrets: [SECRET] })).toEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("does not throw on a signature of the wrong length (constant-time compare guard)", () => {
    expect(
      verifyWebhookSignature({ rawBody: BODY, header: `t=${NOW},v1=ab`, secrets: [SECRET], nowSeconds: NOW }),
    ).toEqual({ valid: false, reason: "mismatch" });
  });
});
