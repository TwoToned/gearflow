import { describe, expect, it, vi } from "vitest";
import { withTimeout } from "./fetch-with-timeout";

describe("withTimeout", () => {
  it("resolves with the wrapped promise's value when it settles first", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1_000)).resolves.toBe("ok");
  });

  it("rejects with the wrapped promise's error when it rejects first", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), 1_000)).rejects.toThrow(
      "boom",
    );
  });

  it("rejects with a timeout error when the promise never settles in time", async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise(() => {});
      const result = withTimeout(never, 10_000, "vendor call");
      const assertion = expect(result).rejects.toThrow(/vendor call timed out after 10000ms/);
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
