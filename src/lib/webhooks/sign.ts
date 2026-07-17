import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Webhook signing, Stripe-style — the convention consumers already know.
 *
 *     X-RVLT-Flow-Signature: t=1783600000,v1=<hex hmac-sha256>
 *
 * (During the rebrand transition the same value is also sent as the legacy
 * `X-GearFlow-Signature` header; consumers should migrate to `X-RVLT-Flow-*`.)
 *
 * The signed message is `${timestamp}.${rawBody}`. Signing the TIMESTAMP as well as
 * the body is what makes a captured payload unreplayable: an attacker cannot move an
 * old, validly-signed body forward in time without invalidating the signature.
 *
 * Comparison is constant-time. A naive `===` on the hex digest leaks, byte by byte,
 * how much of a forged signature was correct.
 *
 * See docs/designs/webhooks.md.
 */

const SECRET_PREFIX = "whsec_";

/** How far a delivery's timestamp may drift before a consumer should reject it. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function generateWebhookSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(24).toString("hex")}`;
}

/**
 * The value of the `X-GearFlow-Signature` header.
 *
 * Accepts MORE THAN ONE secret and emits one `v1=` per secret. That is what makes a
 * rotation grace window real: during the window we sign with both the new and the old
 * secret, so a consumer that hasn't swapped yet still verifies. (Multiple `v1` values
 * is the same shape Stripe uses for exactly this reason.)
 */
export function signWebhookPayload(
  rawBody: string,
  secrets: string | string[],
  timestampSeconds: number,
): string {
  const list = Array.isArray(secrets) ? secrets : [secrets];
  const signatures = list.map(
    (secret) => `v1=${createHmac("sha256", secret).update(`${timestampSeconds}.${rawBody}`).digest("hex")}`,
  );
  return [`t=${timestampSeconds}`, ...signatures].join(",");
}

/**
 * Parse `t=...,v1=...[,v1=...]`. Tolerates extra/reordered parts and collects EVERY
 * `v1` — a rotation-window delivery carries two. Splitting on the first `=` only, so
 * a value containing `=` is not truncated. Returns null if malformed.
 */
export function parseSignatureHeader(header: string): { t: number; v1: string[] } | null {
  const parts = header.split(",").map((p) => p.trim());
  let t: number | undefined;
  const v1: string[] = [];

  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key === "t") {
      const parsed = Number(value);
      if (Number.isInteger(parsed)) t = parsed;
    } else if (key === "v1" && value) {
      v1.push(value);
    }
  }

  return t !== undefined && v1.length > 0 ? { t, v1 } : null;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify a delivery. Exported so consumers don't hand-roll it (and get the
 * constant-time compare and the replay window for free).
 *
 * `secrets` accepts more than one so a rotation grace window works: the current
 * secret and, until it expires, the previous one.
 */
export function verifyWebhookSignature(args: {
  rawBody: string;
  header: string | null | undefined;
  secrets: string[];
  /** Unix seconds. Injected for tests; defaults to now. */
  nowSeconds?: number;
  toleranceSeconds?: number;
}): { valid: boolean; reason?: "malformed" | "expired" | "mismatch" } {
  if (!args.header) return { valid: false, reason: "malformed" };

  const parsed = parseSignatureHeader(args.header);
  if (!parsed) return { valid: false, reason: "malformed" };

  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = args.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(now - parsed.t) > tolerance) return { valid: false, reason: "expired" };

  // Any presented signature matching any accepted secret is enough. Both loops are
  // over short, fixed lists, and the compare inside is constant-time.
  for (const secret of args.secrets) {
    const expected = createHmac("sha256", secret)
      .update(`${parsed.t}.${args.rawBody}`)
      .digest("hex");
    for (const presented of parsed.v1) {
      if (constantTimeEquals(expected, presented)) return { valid: true };
    }
  }

  return { valid: false, reason: "mismatch" };
}
