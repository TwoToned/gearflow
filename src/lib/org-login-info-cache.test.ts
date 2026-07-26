import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  withOrgLoginInfoCache,
  invalidateOrgLoginInfoCache,
  ORG_LOGIN_INFO_TTL_MS,
  ORG_LOGIN_INFO_MAX_ENTRIES,
  type OrgLoginInfo,
} from "./org-login-info-cache";

function info(slug: string): OrgLoginInfo {
  return {
    orgId: `org_${slug}`,
    orgName: `Org ${slug}`,
    orgSlug: slug,
    orgLogo: null,
    hasSSO: true,
    ssoEnabled: true,
    enforceSSO: false,
    allowPasswordLogin: true,
    providers: [
      {
        providerId: "sso-1",
        issuer: "https://idp.example.com",
        domain: "example.com",
        type: "oidc",
        displayName: "Example IdP",
        icon: "key",
      },
    ],
  };
}

describe("withOrgLoginInfoCache", () => {
  beforeEach(() => {
    invalidateOrgLoginInfoCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads once and serves repeat lookups from the cache", async () => {
    const load = vi.fn(async (slug: string) => info(slug));

    const first = await withOrgLoginInfoCache("acme", load);
    const second = await withOrgLoginInfoCache("acme", load);

    expect(load).toHaveBeenCalledTimes(1);
    expect(first).toEqual(info("acme"));
    expect(second).toBe(first);
  });

  it("caches null results for unknown slugs", async () => {
    const load = vi.fn(async () => null);

    expect(await withOrgLoginInfoCache("nope", load)).toBeNull();
    expect(await withOrgLoginInfoCache("nope", load)).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keys the cache per slug", async () => {
    const load = vi.fn(async (slug: string) => info(slug));

    await withOrgLoginInfoCache("a", load);
    await withOrgLoginInfoCache("b", load);

    expect(load).toHaveBeenCalledTimes(2);
    expect((await withOrgLoginInfoCache("a", load))?.orgSlug).toBe("a");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("reloads after the TTL expires", async () => {
    const load = vi.fn(async (slug: string) => info(slug));

    await withOrgLoginInfoCache("acme", load);
    vi.advanceTimersByTime(ORG_LOGIN_INFO_TTL_MS + 1);
    await withOrgLoginInfoCache("acme", load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("reloads after explicit invalidation", async () => {
    const load = vi.fn(async (slug: string) => info(slug));

    await withOrgLoginInfoCache("acme", load);
    invalidateOrgLoginInfoCache();
    await withOrgLoginInfoCache("acme", load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("invalidates a single slug without dropping others", async () => {
    const load = vi.fn(async (slug: string) => info(slug));

    await withOrgLoginInfoCache("a", load);
    await withOrgLoginInfoCache("b", load);
    invalidateOrgLoginInfoCache("a");
    await withOrgLoginInfoCache("a", load);
    await withOrgLoginInfoCache("b", load);

    expect(load).toHaveBeenCalledTimes(3);
  });

  it("serves the stale value when the loader fails", async () => {
    let fail = false;
    const load = vi.fn(async (slug: string) => {
      if (fail) throw new Error("db down");
      return info(slug);
    });

    await withOrgLoginInfoCache("acme", load);
    fail = true;
    vi.advanceTimersByTime(ORG_LOGIN_INFO_TTL_MS + 1);

    const res = await withOrgLoginInfoCache("acme", load);
    expect(res?.orgSlug).toBe("acme");
  });

  it("rethrows a loader failure when nothing is cached for the slug", async () => {
    const load = vi.fn(async () => {
      throw new Error("db down");
    });

    await expect(withOrgLoginInfoCache("acme", load)).rejects.toThrow("db down");
  });

  it("evicts oldest entries past the size cap so arbitrary slugs cannot grow memory", async () => {
    const load = vi.fn(async (slug: string) => info(slug));

    for (let i = 0; i < ORG_LOGIN_INFO_MAX_ENTRIES + 5; i++) {
      await withOrgLoginInfoCache(`slug-${i}`, load);
    }
    expect(load).toHaveBeenCalledTimes(ORG_LOGIN_INFO_MAX_ENTRIES + 5);

    // slug-0 was evicted → reloads. The newest entry is still cached.
    await withOrgLoginInfoCache("slug-0", load);
    expect(load).toHaveBeenCalledTimes(ORG_LOGIN_INFO_MAX_ENTRIES + 6);
    await withOrgLoginInfoCache(`slug-${ORG_LOGIN_INFO_MAX_ENTRIES + 4}`, load);
    expect(load).toHaveBeenCalledTimes(ORG_LOGIN_INFO_MAX_ENTRIES + 6);
  });
});
