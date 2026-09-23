import "server-only";
import { createCipheriv, createECDH, createPrivateKey, createSign, hkdfSync, randomBytes } from "node:crypto";

/**
 * Web Push sender — RFC 8291 (message encryption, `aes128gcm`) + RFC 8292
 * (VAPID). Built on Node's `crypto` rather than the `web-push` package
 * (R-6.3: the platform does it — ECDH P-256, HKDF-SHA256, AES-128-GCM and
 * ES256 are all built in; the package would add a dependency tree for ~80
 * lines). Keys are the formats `scripts/generate-vapid-keys.mts` prints: the
 * raw 65-byte public point and the raw 32-byte private scalar, base64url.
 *
 * Server-only. The first sender is follow-up automation's urgent nudge
 * (`src/server/follow-up-push.ts`, FEATUREDOCS/82).
 */

export interface PushTarget {
  endpoint: string;
  /** Browser's P-256 public key, base64url (PushSubscription `keys.p256dh`). */
  p256dh: string;
  /** 16-byte auth secret, base64url (PushSubscription `keys.auth`). */
  auth: string;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface PushResult {
  ok: boolean;
  status: number;
  /** 404/410: the subscription is dead and should be deleted. */
  gone: boolean;
}

const RECORD_SIZE = 4096;
const b64u = (s: string) => Buffer.from(s, "base64url");

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  return Buffer.from(hkdfSync("sha256", ikm, salt, info, length));
}

/** RFC 8291 §3.4 — encrypt `plaintext` for one subscription. `salt` and the
 *  ephemeral key are parameters only so a test can pin them. */
export function encryptPayload(
  target: Pick<PushTarget, "p256dh" | "auth">,
  plaintext: Buffer,
  opts: { salt?: Buffer; ephemeralPrivateKey?: Buffer } = {},
): Buffer {
  const uaPublic = b64u(target.p256dh);
  const authSecret = b64u(target.auth);
  const ecdh = createECDH("prime256v1");
  if (opts.ephemeralPrivateKey) ecdh.setPrivateKey(opts.ephemeralPrivateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = opts.salt ?? randomBytes(16);

  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, shared, keyInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);

  // One record: plaintext + 0x02 (last-record delimiter), no padding.
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/** RFC 8292 — the `Authorization: vapid t=…, k=…` header for `endpoint`. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, nowMs: number): string {
  const pub = b64u(keys.publicKey);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: pub.subarray(1, 33).toString("base64url"),
    y: pub.subarray(33, 65).toString("base64url"),
    d: keys.privateKey,
  };
  const header = Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })).toString("base64url");
  const claims = Buffer.from(
    JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: keys.subject }),
  ).toString("base64url");
  const signer = createSign("SHA256");
  signer.update(`${header}.${claims}`);
  const sig = signer.sign({ key: createPrivateKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `vapid t=${header}.${claims}.${sig}, k=${keys.publicKey}`;
}

export async function sendWebPush(
  target: PushTarget,
  payload: unknown,
  keys: VapidKeys,
  opts: { ttlSeconds?: number; urgency?: "normal" | "high"; topic?: string; now?: number; fetchImpl?: typeof fetch } = {},
): Promise<PushResult> {
  const body = encryptPayload(target, Buffer.from(JSON.stringify(payload)));
  const headers: Record<string, string> = {
    Authorization: vapidAuthorization(target.endpoint, keys, opts.now ?? Date.now()),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(opts.ttlSeconds ?? 4 * 3600),
    Urgency: opts.urgency ?? "normal",
  };
  // A topic replaces an undelivered push with the same topic (≤32 url-safe chars).
  if (opts.topic) headers.Topic = opts.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  const res = await (opts.fetchImpl ?? fetch)(target.endpoint, { method: "POST", headers, body: new Uint8Array(body) });
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}
