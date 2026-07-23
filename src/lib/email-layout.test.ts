import { describe, expect, it } from "vitest";
import { escapeHtml } from "@/lib/email-layout";

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("neutralises a script-injection payload", () => {
    const payload = `'<img src=x onerror=alert(1)>'`;
    const escaped = escapeHtml(payload);
    expect(escaped).not.toContain("<img");
    expect(escaped).toBe("&#39;&lt;img src=x onerror=alert(1)&gt;&#39;");
  });

  it("leaves plain text untouched", () => {
    expect(escapeHtml("Acme Rentals")).toBe("Acme Rentals");
  });
});
