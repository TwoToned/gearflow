import { describe, test, expect } from "vitest";
import { buildMiraSystemPrompt } from "./system-prompt";
import { MIRA_FEATURE_MAP, MIRA_FEATURE_COUNT } from "./feature-map.generated";

const BASE = {
  organizationName: "Acme Rentals",
  userName: "Ada",
  userRole: "manager",
  canWrite: false,
  pageContext: null,
};

describe("buildMiraSystemPrompt", () => {
  test("names the org and user", () => {
    const prompt = buildMiraSystemPrompt(BASE);
    expect(prompt).toContain('"Acme Rentals"');
    expect(prompt).toContain("Ada");
    expect(prompt).toContain("manager");
  });

  test("includes the full generated feature map — a real map of the product, not just tool descriptions", () => {
    const prompt = buildMiraSystemPrompt(BASE);
    expect(prompt).toContain(MIRA_FEATURE_MAP);
    // The generator's own count should match the number of bullet lines it emitted.
    expect(MIRA_FEATURE_MAP.split("\n").filter(Boolean)).toHaveLength(MIRA_FEATURE_COUNT);
  });

  test("frames the three ways Mira can help: do, look up, explain", () => {
    const prompt = buildMiraSystemPrompt(BASE);
    expect(prompt).toMatch(/DO things/);
    expect(prompt).toMatch(/LOOK UP data/);
    expect(prompt).toMatch(/EXPLAIN how/);
  });

  test("uses the real project status lifecycle, not a stale/invented one", () => {
    const prompt = buildMiraSystemPrompt(BASE);
    expect(prompt).toContain("ENQUIRY");
    expect(prompt).toContain("CONFIRMED");
    expect(prompt).not.toMatch(/\bDRAFT\b/);
  });

  test("write-disabled org tells the model it can't act, and where to fix that", () => {
    const prompt = buildMiraSystemPrompt(BASE);
    expect(prompt).toMatch(/has not enabled write access/i);
    expect(prompt).toContain("Settings → Mira AI Assistant");
  });

  test("write-enabled org explains the confirmation gate instead", () => {
    const prompt = buildMiraSystemPrompt({ ...BASE, canWrite: true });
    expect(prompt).toMatch(/CONFIRMATION_REQUIRED/);
    expect(prompt).not.toMatch(/has not enabled write access/i);
  });

  test("includes the live org snapshot only when provided", () => {
    const withSnapshot = buildMiraSystemPrompt({ ...BASE, orgSnapshot: "3 active project(s)." });
    expect(withSnapshot).toContain("3 active project(s).");

    const without = buildMiraSystemPrompt(BASE);
    expect(without).not.toMatch(/Current org snapshot/);
  });

  test("mentions the current page's entity when page context is set", () => {
    const prompt = buildMiraSystemPrompt({ ...BASE, pageContext: { entityType: "project", entityId: "proj_1" } });
    expect(prompt).toContain("currently looking at a project");
    expect(prompt).toContain("proj_1");
  });
});
