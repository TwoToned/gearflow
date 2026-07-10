/**
 * Endpoint URL validation.
 *
 * Two jobs. First, force `https://` so a signed payload never crosses the wire in the
 * clear. Second, refuse private and loopback hosts: an org admin (or an agent holding
 * their key) could otherwise aim a webhook at internal infrastructure and use GearFlow
 * as an SSRF probe, reading results back through the delivery log's `responseStatus`
 * and `lastError`.
 *
 * `http://localhost` is allowed in development so the feature is testable.
 *
 * ## What this does and does not close
 *
 * The WHATWG URL parser normalises the sneaky IPv4 spellings for us — `2130706433`,
 * `0177.0.0.1`, `0x7f.1` and `127.0.0.1.` all come out of `new URL().hostname` as
 * `127.0.0.1`. Userinfo (`https://evil.com@127.0.0.1`) likewise resolves to the real
 * host. What it does NOT normalise is IPv6, so `[::ffff:169.254.169.254]` (an
 * IPv6-mapped IPv4 pointing at the cloud metadata endpoint) sailed past an
 * IPv4-only check. Every IPv6 form is handled below.
 *
 * Still open, by design, and documented in FEATUREDOCS/58: a hostname that resolves
 * to a private address only at *delivery* time (DNS rebinding). Closing that needs
 * resolution-time address pinning. `deliver.ts` sets `redirect: "manual"` so a
 * validated endpoint cannot 302 us onto an internal address either — that redirect
 * hole would otherwise defeat everything here.
 */

/** RFC1918, loopback, link-local, and carrier-grade NAT ranges. */
function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (octets.some((o) => o > 255)) return false;
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8 — "this host"
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/** Expand an IPv6 address (with `::`) into its 8 16-bit groups. Null if unparseable. */
function expandIpv6(address: string): number[] | null {
  let text = address;

  // `::ffff:127.0.0.1` — an IPv4 address embedded in IPv6. Fold the dotted tail
  // into two hex groups so the range checks below see it.
  const v4 = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text);
  if (v4) {
    const parts = v4[2].split(".").map(Number);
    if (parts.some((p) => Number.isNaN(p) || p > 255)) return null;
    const hi = (parts[0] << 8) | parts[1];
    const lo = (parts[2] << 8) | parts[3];
    text = `${v4[1]}${hi.toString(16)}:${lo.toString(16)}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;

  const parse = (chunk: string): number[] | null => {
    if (!chunk) return [];
    const out: number[] = [];
    for (const group of chunk.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      out.push(parseInt(group, 16));
    }
    return out;
  };

  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if (!head || !tail) return null;

  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    return [...head, ...Array(fill).fill(0), ...tail];
  }
  return head.length === 8 ? head : null;
}

function isPrivateIpv6(host: string): boolean {
  const groups = expandIpv6(host);
  if (!groups) return false;

  // ::1 (loopback, in any spelling) and :: (unspecified).
  const allZeroButLast = groups.slice(0, 7).every((g) => g === 0);
  if (allZeroButLast && (groups[7] === 1 || groups[7] === 0)) return true;

  // ::ffff:0:0/96 — IPv4-mapped. The embedded v4 was folded into groups 6 and 7.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const a = groups[6] >> 8;
    const b = groups[6] & 0xff;
    const c = groups[7] >> 8;
    const d = groups[7] & 0xff;
    return isPrivateIpv4(`${a}.${b}.${c}.${d}`);
  }

  // 64:ff9b::/96 — NAT64. Embeds an IPv4 in the low 32 bits; on a network with a
  // NAT64 gateway this routes to that IPv4, so check the embedded address.
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) {
    const a = groups[6] >> 8, b = groups[6] & 0xff, c = groups[7] >> 8, d = groups[7] & 0xff;
    return isPrivateIpv4(`${a}.${b}.${c}.${d}`);
  }

  if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7  unique-local
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

/** Loopback by name, including `foo.localhost` (which resolves to 127.0.0.1). */
function isLoopbackName(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost");
}

/** Normalise a URL hostname: lowercase, strip IPv6 brackets and any trailing dot. */
function normaliseHost(hostname: string): string {
  let host = hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.endsWith(".")) host = host.slice(0, -1);
  return host;
}

export { normaliseHost };

export function isPrivateHost(hostname: string): boolean {
  const host = normaliseHost(hostname);
  return isLoopbackName(host) || isPrivateIpv4(host) || isPrivateIpv6(host);
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

  const host = normaliseHost(url.hostname);
  const loopback = isLoopbackName(host) || isPrivateIpv4(host) || isPrivateIpv6(host);

  if (url.protocol !== "https:") {
    // Only ever relax this for a loopback host in development.
    if (!(opts.allowInsecure && url.protocol === "http:" && loopback)) {
      return { ok: false, reason: "The URL must use https://." };
    }
  }

  if (loopback && !opts.allowInsecure) {
    return { ok: false, reason: "The URL must not point at a private or loopback address." };
  }

  return { ok: true };
}
