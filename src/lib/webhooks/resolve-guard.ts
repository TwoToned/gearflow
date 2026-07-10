import { lookup } from "node:dns/promises";
import { isPrivateHost } from "./url";

/**
 * Delivery-time SSRF guard.
 *
 * `validateWebhookUrl` (creation time) only sees the URL string, so a plain hostname
 * that RESOLVES to an internal address — `metadata.google.internal`, or an attacker's
 * domain with an A record pointing at `169.254.169.254` — sails past it. This resolves
 * the host at send time and rejects if ANY resolved address is private/loopback.
 *
 * It does not fully close DNS rebinding (a name could resolve to a public IP here and a
 * private one microseconds later at connect), but it closes the far more practical
 * static-resolution bypass. Full closure needs pinning the connection to the address we
 * validated; noted in FEATUREDOCS/58.
 */
export async function hostResolvesToPrivate(url: string): Promise<boolean> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return true; // unparseable — treat as unsafe
  }

  // An IP literal was already range-checked by validateWebhookUrl; re-check cheaply
  // (covers bracketed IPv6) and skip DNS.
  if (isPrivateHost(hostname)) return true;

  try {
    const addresses = await lookup(hostname, { all: true });
    return addresses.some((a) => isPrivateHost(a.address));
  } catch {
    // A name that doesn't resolve can't be delivered to anyway; let the fetch fail
    // and be recorded, rather than blocking on a transient DNS hiccup.
    return false;
  }
}
