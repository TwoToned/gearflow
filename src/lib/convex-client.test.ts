/**
 * Unit tests for `withConvexReadRetry` — the transient-blip resilience wrapper on
 * the cross-domain Convex read helpers (clients / models / suppliers / categories)
 * that feed the projects list + detail. Regression guard for the "random client
 * crash": a single transient Convex `InternalServerError` on those reads used to
 * propagate uncaught and take down a page that was pure Prisma pre-migration.
 *
 * Properties: success short-circuits (no retry), a one-shot transient failure is
 * absorbed by the retry, and a PERSISTENT failure still surfaces (so a real outage
 * is never hidden).
 */
import { describe, it, expect, vi } from "vitest";
import { withConvexReadRetry } from "@/lib/convex-client";

describe("withConvexReadRetry", () => {
  it("returns on first success without retrying", async () => {
    const run = vi.fn().mockResolvedValue("ok");
    await expect(withConvexReadRetry(run)).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("retries once and succeeds on the second attempt (transient blip absorbed)", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(
        new Error('{"code":"InternalServerError","message":"Try again later."}'),
      )
      .mockResolvedValueOnce(["row"]);
    await expect(withConvexReadRetry(run)).resolves.toEqual(["row"]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("rethrows when both attempts fail (persistent error still surfaces)", async () => {
    const run = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(withConvexReadRetry(run)).rejects.toThrow("boom");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("jitters the retry delay instead of using a fixed value (R-9.6 — no retry storms)", async () => {
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("blip"))
      .mockResolvedValueOnce("ok");

    await withConvexReadRetry(run);

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    const delay = setTimeoutSpy.mock.calls[0][1] as number;
    expect(delay).toBeGreaterThanOrEqual(100);
    expect(delay).toBeLessThan(200);
    setTimeoutSpy.mockRestore();
  });
});
