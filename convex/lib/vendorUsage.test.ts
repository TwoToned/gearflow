import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { reportConvexVendorUsage } from "./vendorUsage";

const ENV_KEYS = ["POSTHOG_KEY", "POSTHOG_HOST"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe("reportConvexVendorUsage", () => {
  test("no-ops when POSTHOG_KEY is unset", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await reportConvexVendorUsage("resend", "send");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("POSTs a vendor_usage event with an AbortSignal (R-9.6)", async () => {
    process.env.POSTHOG_KEY = "phc_test";
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.signal?.aborted).toBe(false);
      return { ok: true, status: 200, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchSpy);

    await reportConvexVendorUsage("resend", "send");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://us.i.posthog.com/capture/");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      api_key: "phc_test",
      event: "vendor_usage",
      distinct_id: "server",
      properties: { vendor: "resend", operation: "send", units: 1 },
    });
  });

  test("never throws even when the outbound POST rejects", async () => {
    process.env.POSTHOG_KEY = "phc_test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    await expect(reportConvexVendorUsage("resend", "send")).resolves.toBeUndefined();
  });
});
