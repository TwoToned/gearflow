/**
 * HMAC request signing for the bot ↔ GearFlow trust boundary.
 *
 * The standalone bot signs every request to `src/app/api/discord/v1/*` with the
 * per-org `DiscordIntegration.signingSecret`. Signature covers `timestamp.rawBody`
 * so a captured body cannot be replayed outside the time window.
 *
 * Hardened vs the existing `verifyWebhookSignature` (woocommerce-utils.ts), which
 * passes attacker-controlled input straight into `crypto.timingSafeEqual` — that
 * THROWS when the two buffers differ in length (any malformed signature). Here we
 * length-check first and never throw on bad input.
 */
import crypto from "crypto";

export const DISCORD_SIG_HEADER = "x-gearflow-signature";
export const DISCORD_TS_HEADER = "x-gearflow-timestamp";

/** Max clock skew between bot and app before a request is rejected (replay guard). */
export const DISCORD_SIG_MAX_SKEW_SECONDS = 300;

/** Compute the signature for a request body at a given unix-second timestamp. */
export function signDiscordRequest(rawBody: string, timestamp: number, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("base64");
}

/** Constant-time string compare that never throws on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export interface VerifyResult {
  valid: boolean;
  reason?: "missing" | "stale" | "mismatch";
}

/**
 * Verify a signed request. `nowSeconds` is injectable for tests.
 * Returns a structured result rather than throwing — the route maps a failure
 * to a SIGNATURE_INVALID DiscordApiError.
 */
export function verifyDiscordRequest(
  rawBody: string,
  signature: string | null | undefined,
  timestamp: string | null | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): VerifyResult {
  if (!signature || !timestamp) return { valid: false, reason: "missing" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { valid: false, reason: "missing" };
  if (Math.abs(nowSeconds - ts) > DISCORD_SIG_MAX_SKEW_SECONDS) {
    return { valid: false, reason: "stale" };
  }

  const expected = signDiscordRequest(rawBody, ts, secret);
  return safeEqual(signature, expected) ? { valid: true } : { valid: false, reason: "mismatch" };
}
