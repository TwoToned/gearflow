/**
 * Endpoint URL validation.
 *
 * Two jobs. First, force `https://` so a signed payload never crosses the wire in the
 * clear. Second, refuse private and loopback hosts: an org admin could otherwise aim a
 * webhook at internal infrastructure and use GearFlow as an SSRF probe, reading back
 * results through the delivery log's `responseStatus`.
 *
 * `http://localhost` is allowed in development so the feature is testable.
 *
 * This is a hostname check, not a resolver check. A hostname that resolves to a
 * private address at delivery time (DNS rebinding) still gets through; closing that
 * needs resolution-time pinning, which is noted as a limitation in FEATUREDOCS/57.
 */

const PRIVATE_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

/** RFC1918, link-local, and carrier-grade NAT ranges. */
function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

export interface UrlCheck {
  ok: boolean;
  reason?: string;
}

export function validateWebhookUrl(raw: string, opts: { allowInsecure?: boolean } = {}): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Not a valid URL." };
  }

  const isLoopback = PRIVATE_HOSTNAMES.has(url.hostname);

  if (url.protocol !== "https:") {
    // Only ever relax this for a loopback host in development.
    if (!(opts.allowInsecure && url.protocol === "http:" && isLoopback)) {
      return { ok: false, reason: "The URL must use https://." };
    }
  }

  if (isLoopback || isPrivateIpv4(url.hostname)) {
    if (!opts.allowInsecure) {
      return { ok: false, reason: "The URL must not point at a private or loopback address." };
    }
  }

  return { ok: true };
}
