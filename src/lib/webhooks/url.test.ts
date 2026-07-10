import { describe, it, expect } from "vitest";
import { validateWebhookUrl } from "./url";

describe("validateWebhookUrl", () => {
  it("accepts a public https endpoint", () => {
    expect(validateWebhookUrl("https://hooks.example.com/gearflow")).toEqual({ ok: true });
  });

  it("rejects http — a signed payload must not cross the wire in the clear", () => {
    expect(validateWebhookUrl("http://hooks.example.com/x").ok).toBe(false);
  });

  it("rejects nonsense", () => {
    expect(validateWebhookUrl("not a url").ok).toBe(false);
    expect(validateWebhookUrl("ftp://example.com").ok).toBe(false);
  });

  describe("SSRF: private and loopback hosts", () => {
    const blocked = [
      "https://localhost/x",
      "https://sub.localhost/x", // resolves to loopback
      "https://127.0.0.1/x",
      "https://10.1.2.3/x",
      "https://172.16.0.1/x",
      "https://172.31.255.255/x",
      "https://192.168.1.1/x",
      "https://100.64.0.1/x", // CGNAT
      "https://169.254.169.254/latest/meta-data", // cloud metadata endpoint
      "https://0.0.0.0/x",
      // The WHATWG URL parser normalises these IPv4 spellings to 127.0.0.1:
      "https://2130706433/x", // decimal
      "https://0177.0.0.1/x", // octal
      "https://0x7f.0.0.1/x", // hex
      "https://127.0.0.1./x", // trailing dot
      "https://evil.com@127.0.0.1/x", // userinfo — real host is 127.0.0.1
      // IPv6, the class the first cut missed entirely:
      "https://[::1]/x",
      "https://[::ffff:127.0.0.1]/x", // IPv4-mapped loopback
      "https://[::ffff:169.254.169.254]/x", // IPv4-mapped metadata endpoint
      "https://[0:0:0:0:0:ffff:a00:1]/x", // IPv4-mapped 10.0.0.1, fully expanded
      "https://[fc00::1]/x", // unique-local
      "https://[fe80::1]/x", // link-local
      "https://[64:ff9b::a9fe:a9fe]/x", // NAT64-embedded 169.254.169.254
      "https://[64:ff9b::7f00:1]/x", // NAT64-embedded 127.0.0.1
    ];
    for (const url of blocked) {
      it(`rejects ${url}`, () => {
        expect(validateWebhookUrl(url).ok).toBe(false);
      });
    }

    it("allows a public address that merely looks adjacent", () => {
      expect(validateWebhookUrl("https://172.32.0.1/x").ok).toBe(true);
      expect(validateWebhookUrl("https://11.0.0.1/x").ok).toBe(true);
      expect(validateWebhookUrl("https://[2606:4700:4700::1111]/x").ok).toBe(true); // public IPv6 (1.1.1.1)
    });
  });

  describe("development", () => {
    it("allows http://localhost so the feature is testable", () => {
      expect(validateWebhookUrl("http://localhost:3000/hook", { allowInsecure: true })).toEqual({
        ok: true,
      });
    });

    it("still rejects a non-loopback http URL even when insecure is allowed", () => {
      expect(validateWebhookUrl("http://example.com/hook", { allowInsecure: true }).ok).toBe(false);
    });
  });
});
