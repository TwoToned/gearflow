// @vitest-environment node
//
// Web Push sender (FEATUREDOCS/82) — pinned to RFC 8291 Appendix A's worked
// example, so the encryption is proved against the spec rather than against
// itself; the VAPID JWT is verified with the public key a push service holds.
import { describe, it, expect, vi } from "vitest";
import { createPublicKey, createVerify, generateKeyPairSync } from "node:crypto";
import { encryptPayload, sendWebPush, vapidAuthorization } from "./web-push";

vi.mock("server-only", () => ({}));

const b64u = (s: string) => Buffer.from(s, "base64url");

describe("encryptPayload", () => {
  it("matches RFC 8291 Appendix A byte for byte", () => {
    const out = encryptPayload(
      {
        p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        auth: "BTBZMqHH6r4Tts7J_aSIgg",
      },
      Buffer.from("When I grow up, I want to be a watermelon"),
      { salt: b64u("DGv6ra1nlYgDCS1FRnbzlw"), ephemeralPrivateKey: b64u("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw") },
    );
    expect(out.toString("base64url")).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });
});

function vapidIdentity() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pub = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const raw = Buffer.concat([Buffer.from([4]), b64u(pub.x), b64u(pub.y)]).toString("base64url");
  return { publicKey: raw, privateKey: (privateKey.export({ format: "jwk" }) as { d: string }).d, subject: "mailto:ops@example.com", jwk: pub };
}

describe("vapidAuthorization", () => {
  it("signs an ES256 JWT for the endpoint's origin that the public key verifies", () => {
    const keys = vapidIdentity();
    const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", keys, Date.UTC(2026, 8, 23));
    const [, token, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(k).toBe(keys.publicKey);
    const [h, c, sig] = token!.split(".");
    expect(JSON.parse(b64u(c!).toString())).toMatchObject({ aud: "https://fcm.googleapis.com", sub: "mailto:ops@example.com" });
    const verifier = createVerify("SHA256");
    verifier.update(`${h}.${c}`);
    const key = createPublicKey({ key: { kty: "EC", crv: "P-256", ...keys.jwk }, format: "jwk" });
    expect(verifier.verify({ key, dsaEncoding: "ieee-p1363" }, b64u(sig!))).toBe(true);
  });
});

describe("sendWebPush", () => {
  const target = {
    endpoint: "https://web.push.apple.com/QGuQyavXutnMH/sub1",
    p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    auth: "BTBZMqHH6r4Tts7J_aSIgg",
  };

  it("posts an aes128gcm body with VAPID, TTL, urgency and a sanitised topic", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
    const res = await sendWebPush(target, { title: "x" }, vapidIdentity(), { urgency: "high", topic: "follow-up:t1", fetchImpl });
    expect(res).toEqual({ ok: true, status: 201, gone: false });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe(target.endpoint);
    expect(headers).toMatchObject({ "Content-Encoding": "aes128gcm", Urgency: "high", Topic: "follow-upt1" });
    expect(headers.Authorization).toMatch(/^vapid t=/);
  });

  it("never requests an endpoint that isn't a known push service (request forgery)", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
    for (const endpoint of [
      "http://web.push.apple.com/x",
      "https://169.254.169.254/latest/meta-data",
      "https://web.push.apple.com.evil.test/x",
      "https://user@web.push.apple.com/x",
      "https://web.push.apple.com:8443/x",
      "not a url",
    ]) {
      expect(await sendWebPush({ ...target, endpoint }, {}, vapidIdentity(), { fetchImpl })).toEqual({ ok: false, status: 0, gone: true });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a 410 as a gone subscription", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 410 }));
    expect(await sendWebPush(target, {}, vapidIdentity(), { fetchImpl })).toEqual({ ok: false, status: 410, gone: true });
  });
});
