import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  withJwksResponseCache,
  resetJwksResponseCache,
  JWKS_ROUTE_PATH,
  JWKS_TTL_MS,
  JWKS_CACHE_CONTROL,
} from "./jwks-route-cache";

const JWKS_URL = `https://flow.example.com${JWKS_ROUTE_PATH}`;
const KEYS_BODY = JSON.stringify({ keys: [{ kid: "k1", kty: "EC", alg: "ES256" }] });

function jwksRequest(url = JWKS_URL): Request {
  return new Request(url, { method: "GET" });
}

describe("withJwksResponseCache", () => {
  beforeEach(() => {
    resetJwksResponseCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves the JWKS from the wrapped handler with cache headers on first fetch", async () => {
    const handler = vi.fn(async () => new Response(KEYS_BODY, { status: 200 }));
    const wrapped = withJwksResponseCache(handler);

    const res = await wrapped(jwksRequest());

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(KEYS_BODY);
    expect(res.headers.get("Cache-Control")).toBe(JWKS_CACHE_CONTROL);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("serves repeat requests from the memo without re-invoking the handler", async () => {
    const handler = vi.fn(async () => new Response(KEYS_BODY, { status: 200 }));
    const wrapped = withJwksResponseCache(handler);

    await wrapped(jwksRequest());
    const res2 = await wrapped(jwksRequest());
    const res3 = await wrapped(jwksRequest());

    expect(handler).toHaveBeenCalledTimes(1);
    expect(await res2.text()).toBe(KEYS_BODY);
    expect(await res3.text()).toBe(KEYS_BODY);
    expect(res2.headers.get("Cache-Control")).toBe(JWKS_CACHE_CONTROL);
  });

  it("re-fetches after the TTL expires", async () => {
    const handler = vi.fn(async () => new Response(KEYS_BODY, { status: 200 }));
    const wrapped = withJwksResponseCache(handler);

    await wrapped(jwksRequest());
    vi.advanceTimersByTime(JWKS_TTL_MS + 1);
    await wrapped(jwksRequest());

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("passes non-jwks auth routes through untouched", async () => {
    const passthrough = new Response("session", { status: 200 });
    const handler = vi.fn(async () => passthrough);
    const wrapped = withJwksResponseCache(handler);

    const res = await wrapped(jwksRequest("https://flow.example.com/api/auth/get-session"));

    expect(res).toBe(passthrough);
    expect(res.headers.get("Cache-Control")).toBeNull();
    // Passthrough must never be memoized: a second jwks request still hits the handler.
    await wrapped(jwksRequest());
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("serves the last-known-good key set when the handler starts failing", async () => {
    let fail = false;
    const handler = vi.fn(async () => {
      if (fail) throw new Error("db down");
      return new Response(KEYS_BODY, { status: 200 });
    });
    const wrapped = withJwksResponseCache(handler);

    await wrapped(jwksRequest());
    fail = true;
    vi.advanceTimersByTime(JWKS_TTL_MS + 1);

    const res = await wrapped(jwksRequest());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(KEYS_BODY);
  });

  it("serves stale on a non-ok downstream response", async () => {
    let status = 200;
    const handler = vi.fn(async () =>
      status === 200
        ? new Response(KEYS_BODY, { status: 200 })
        : new Response("boom", { status: 500 }),
    );
    const wrapped = withJwksResponseCache(handler);

    await wrapped(jwksRequest());
    status = 500;
    vi.advanceTimersByTime(JWKS_TTL_MS + 1);

    const res = await wrapped(jwksRequest());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(KEYS_BODY);
  });

  it("propagates the failure when there is no cached key set yet", async () => {
    const handler = vi.fn(async () => {
      throw new Error("db down");
    });
    const wrapped = withJwksResponseCache(handler);

    await expect(wrapped(jwksRequest())).rejects.toThrow("db down");
  });

  it("returns the downstream error response when there is no cached key set yet", async () => {
    const handler = vi.fn(async () => new Response("boom", { status: 500 }));
    const wrapped = withJwksResponseCache(handler);

    const res = await wrapped(jwksRequest());
    expect(res.status).toBe(500);
  });
});
