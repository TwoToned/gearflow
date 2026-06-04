import { describe, it, expect } from "vitest";
import { formatChannelName } from "./channel-name";

describe("formatChannelName", () => {
  it("builds PROJECTCODE-projectname, slugified + lowercase", () => {
    expect(formatChannelName("TTP001", "Pippin")).toBe("ttp001-pippin");
  });

  it("collapses spaces/punctuation into single dashes", () => {
    expect(formatChannelName("P-2024-1", "Romeo & Juliet (Act II)")).toBe("p-2024-1-romeo-juliet-act-ii");
  });

  it("trims leading/trailing dashes", () => {
    expect(formatChannelName("  TTP 9  ", "  Show!  ")).toBe("ttp-9-show");
  });

  it("is deterministic — same input → same name (idempotent diff target)", () => {
    expect(formatChannelName("TTP001", "Pippin")).toBe(formatChannelName("TTP001", "Pippin"));
  });

  it("truncates to Discord's 100-char limit without a trailing dash", () => {
    const name = formatChannelName("TTP001", "x".repeat(200));
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.endsWith("-")).toBe(false);
  });

  it("falls back to the code when the name slugifies to empty", () => {
    expect(formatChannelName("TTP001", "!!!")).toBe("ttp001");
  });
});
