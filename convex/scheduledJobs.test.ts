// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

// Snapshot + restore the env keys these actions read so tests don't leak state.
const ENV_KEYS = ["ENABLE_CONVEX_CRONS", "CONVEX_CRON_TARGET_URL", "CRON_SECRET"] as const;
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

describe("scheduledJobs — dormant gate", () => {
  test("runNotificationEmails no-ops (skipped) when ENABLE_CONVEX_CRONS is unset", async () => {
    const t = convexTest(schema, modules);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await t.action(internal.scheduledJobs.runNotificationEmails, {});
    expect(res).toEqual({ skipped: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("runTestTagReminders no-ops when flag is any value other than the literal 'true'", async () => {
    process.env.ENABLE_CONVEX_CRONS = "1"; // truthy string, but not exactly "true"
    const t = convexTest(schema, modules);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await t.action(internal.scheduledJobs.runTestTagReminders, {});
    expect(res).toEqual({ skipped: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("scheduledJobs — enabled", () => {
  test("throws when enabled but target URL / secret are missing", async () => {
    process.env.ENABLE_CONVEX_CRONS = "true";
    const t = convexTest(schema, modules);
    await expect(
      t.action(internal.scheduledJobs.runNotificationEmails, {}),
    ).rejects.toThrow(/CONVEX_CRON_TARGET_URL and CRON_SECRET/);
  });

  test("POSTs the notifications route with the bearer secret and trims a trailing slash", async () => {
    process.env.ENABLE_CONVEX_CRONS = "true";
    process.env.CONVEX_CRON_TARGET_URL = "https://flow.rvlt.app/";
    process.env.CRON_SECRET = "s3cret";
    const t = convexTest(schema, modules);

    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 200, text: async () => "ok-body" }));
    vi.stubGlobal("fetch", fetchSpy);

    const res = await t.action(internal.scheduledJobs.runNotificationEmails, {});
    expect(res).toEqual({ status: 200, body: "ok-body" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://flow.rvlt.app/api/cron/notifications");
    expect(init).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer s3cret" },
    });
  });

  test("test-tag reminders posts its own route", async () => {
    process.env.ENABLE_CONVEX_CRONS = "true";
    process.env.CONVEX_CRON_TARGET_URL = "https://flow.rvlt.app";
    process.env.CRON_SECRET = "s3cret";
    const t = convexTest(schema, modules);

    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 200, text: async () => "" }));
    vi.stubGlobal("fetch", fetchSpy);

    await t.action(internal.scheduledJobs.runTestTagReminders, {});
    expect(fetchSpy.mock.calls[0][0]).toBe("https://flow.rvlt.app/api/cron/test-tag-reminders");
  });

  test("throws (surfaces the failure) on a non-2xx executor response", async () => {
    process.env.ENABLE_CONVEX_CRONS = "true";
    process.env.CONVEX_CRON_TARGET_URL = "https://flow.rvlt.app";
    process.env.CRON_SECRET = "s3cret";
    const t = convexTest(schema, modules);

    const fetchSpy = vi.fn(async () => ({ ok: false, status: 500, text: async () => "boom" }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      t.action(internal.scheduledJobs.runNotificationEmails, {}),
    ).rejects.toThrow(/failed: 500/);
  });
});
