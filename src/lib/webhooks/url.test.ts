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
      "https://127.0.0.1/x",
      "https://10.1.2.3/x",
      "https://172.16.0.1/x",
      "https://172.31.255.255/x",
      "https://192.168.1.1/x",
      "https://100.64.0.1/x", // CGNAT
      "https://169.254.169.254/latest/meta-data", // cloud metadata endpoint
    ];
    for (const url of blocked) {
      it(`rejects ${url}`, () => {
        expect(validateWebhookUrl(url).ok).toBe(false);
      });
    }

    it("allows a public address that merely looks adjacent", () => {
      expect(validateWebhookUrl("https://172.32.0.1/x").ok).toBe(true);
      expect(validateWebhookUrl("https://11.0.0.1/x").ok).toBe(true);
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
