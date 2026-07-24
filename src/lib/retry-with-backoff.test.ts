import { describe, expect, it, vi } from "vitest";
import {
  HttpStatusError,
  isRetryableHttpStatus,
  retryWithBackoff,
} from "@/lib/retry-with-backoff";

describe("retryWithBackoff", () => {
  it("returns the result on first success without retrying", async () => {
    const run = vi.fn().mockResolvedValue("ok");
    const result = await retryWithBackoff(run, { baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("retries a failing call and succeeds within maxAttempts", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("ok");
    const onRetry = vi.fn();
    const result = await retryWithBackoff(run, { baseDelayMs: 1, onRetry });
    expect(result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1);
  });

  it("throws the last error once maxAttempts is exhausted", async () => {
    const err = new Error("persistent");
    const run = vi.fn().mockRejectedValue(err);
    await expect(
      retryWithBackoff(run, { baseDelayMs: 1, maxAttempts: 3 }),
    ).rejects.toThrow("persistent");
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("stops immediately when shouldRetry returns false", async () => {
    const err = new Error("non-retryable");
    const run = vi.fn().mockRejectedValue(err);
    await expect(
      retryWithBackoff(run, {
        baseDelayMs: 1,
        maxAttempts: 3,
        shouldRetry: () => false,
      }),
    ).rejects.toThrow("non-retryable");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("defaults to 3 total attempts", async () => {
    const run = vi.fn().mockRejectedValue(new Error("fail"));
    await expect(retryWithBackoff(run, { baseDelayMs: 1 })).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(3);
  });
});

describe("isRetryableHttpStatus", () => {
  it("treats 429 and 5xx as retryable", () => {
    expect(isRetryableHttpStatus(429)).toBe(true);
    expect(isRetryableHttpStatus(500)).toBe(true);
    expect(isRetryableHttpStatus(503)).toBe(true);
  });

  it("treats other 4xx as non-retryable", () => {
    expect(isRetryableHttpStatus(400)).toBe(false);
    expect(isRetryableHttpStatus(401)).toBe(false);
    expect(isRetryableHttpStatus(404)).toBe(false);
  });
});

describe("HttpStatusError", () => {
  it("carries the status code", () => {
    const err = new HttpStatusError("boom", 503);
    expect(err.status).toBe(503);
    expect(err.message).toBe("boom");
    expect(err.name).toBe("HttpStatusError");
  });
});
