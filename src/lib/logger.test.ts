import { afterEach, describe, expect, it, vi } from "vitest";
import { logger, scrub } from "./logger";

afterEach(() => vi.restoreAllMocks());

describe("logger scrubbing", () => {
  it("redacts sensitive keys at any depth", () => {
    const out = scrub({
      email: "a@b.com",
      nested: { password: "hunter2", ok: 1, token: "abc" },
      list: [{ apiKey: "k" }],
    }) as Record<string, unknown>;
    expect(out.email).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).password).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).ok).toBe(1);
    expect(((out.list as unknown[])[0] as Record<string, unknown>).apiKey).toBe(
      "[redacted]",
    );
  });

  it("emits one structured JSON line with level + message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("boom", { requestId: "r1", detail: "x" });
    expect(spy).toHaveBeenCalledOnce();
    const rec = JSON.parse(spy.mock.calls[0][0] as string);
    expect(rec.level).toBe("error");
    expect(rec.message).toBe("boom");
    expect(rec.requestId).toBe("r1");
  });
});
