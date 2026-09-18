#!/usr/bin/env tsx
/**
 * One-off VAPID key pair generator for Web Push (#1244, design §13).
 *
 * No new dependency: VAPID keys are a plain EC P-256 (prime256v1) key pair,
 * base64url-encoded — Node's built-in `crypto` generates them directly, so
 * this doesn't need the `web-push` package (deliberately not added; the
 * actual push-SEND side is a documented follow-up, see FEATUREDOCS/50, and
 * only THAT side needs a sender library).
 *
 * Usage: `pnpm exec tsx scripts/generate-vapid-keys.mts`
 *
 * Prints the three env vars this deployment needs:
 *   - NEXT_PUBLIC_VAPID_PUBLIC_KEY (inlined into the browser bundle — the
 *     public half is not a secret; it identifies the sending application
 *     server to the push service)
 *   - VAPID_PRIVATE_KEY (server-only — signs push requests; never expose)
 *   - VAPID_SUBJECT (a mailto: or https: contact URL push services may
 *     contact if a sender misbehaves — set once, doesn't rotate with keys)
 *
 * Run again to rotate: every subscriber's existing subscription silently
 * stops receiving pushes until they re-subscribe against the new public
 * key (the Push API has no server-side re-key path) — rotate rarely.
 */
import { generateKeyPairSync } from "node:crypto";

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function main() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

  // Public key: the raw 65-byte uncompressed EC point (0x04 || X || Y), which
  // is what applicationServerKey / VAPID expect — NOT the SPKI DER wrapper
  // Node's default export gives you. jwk export exposes the raw x/y directly.
  const publicJwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const x = Buffer.from(publicJwk.x, "base64url");
  const y = Buffer.from(publicJwk.y, "base64url");
  const rawPublic = Buffer.concat([Buffer.from([0x04]), x, y]);

  // Private key: the raw 32-byte scalar `d`.
  const privateJwk = privateKey.export({ format: "jwk" }) as { d: string };
  const rawPrivate = Buffer.from(privateJwk.d, "base64url");

  console.log("Generated a new VAPID key pair. Add these to the deploy environment:\n");
  console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${base64url(rawPublic)}`);
  console.log(`VAPID_PRIVATE_KEY=${base64url(rawPrivate)}`);
  console.log(`VAPID_SUBJECT=mailto:ops@rvlt.app  # set once; change to a real contact address`);
  console.log("\nNever commit these. Rotating invalidates every existing browser subscription.");
}

main();
