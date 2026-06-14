/**
 * Regression tests for `fetchConvexAccessToken` — the resilient Convex browser
 * token fetch. Root cause of the confirmed "random client crash": the old inline
 * fetcher returned `null` on the FIRST transient `/api/auth/token` failure, which
 * de-auths the Convex client and makes every live subscription throw "Unauthorized:
 * authentication required." (masked as InternalServerError in prod). Confirmed in
 * the Convex logs at `requireOrgReadDoc` ← `warehouseDetail:version`.
 *
 * The contract pinned here: retry transient failures (5xx / network), surrender the
 * token (return null) ONLY on a genuine 401/403 or after the retries are spent.
 */
import { describe, it, expect, vi } from "vitest";
import { fetchConvexAccessToken } from "@/lib/convex-token-fetch";

const ok = (token: string) =>
  ({ ok: true, status: 200, json: async () => ({ token }) }) as Response;
const fail = (httpStatus: number) =>
  ({ ok: false, status: httpStatus, json: async () => ({}) }) as Response;
const noSleep = async () => {};

describe("fetchConvexAccessToken", () => {
  it("returns the token on first success without retrying", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok("jwt-1"));
    await expect(
      fetchConvexAccessToken(fetchImpl as unknown as typeof fetch, noSleep),
    ).resolves.toBe("jwt-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("surrenders immediately on a genuine 401 (really logged out) — no retry", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fail(401));
    await expect(
      fetchConvexAccessToken(fetchImpl as unknown as typeof fetch, noSleep),
    ).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a transient 5xx and recovers — keeps the client authed", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fail(503))
      .mockResolvedValueOnce(ok("jwt-2"));
    await expect(
      fetchConvexAccessToken(fetchImpl as unknown as typeof fetch, noSleep),
    ).resolves.toBe("jwt-2");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries a network throw and recovers", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce(ok("jwt-3"));
    await expect(
      fetchConvexAccessToken(fetchImpl as unknown as typeof fetch, noSleep),
    ).resolves.toBe("jwt-3");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns null only after exhausting retries on a persistent 5xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fail(500));
    await expect(
      fetchConvexAccessToken(fetchImpl as unknown as typeof fetch, noSleep),
    ).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("returns null when an ok response carries no token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);
    await expect(
      fetchConvexAccessToken(fetchImpl as unknown as typeof fetch, noSleep),
    ).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
