import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

async function loadEnv(envOverrides: Record<string, string | undefined>) {
  vi.resetModules();
  // Clear the in-test default for VITEST so we can exercise the production
  // path with explicit overrides.
  for (const key of Object.keys(envOverrides)) {
    if (envOverrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = envOverrides[key];
    }
  }
  return import("./env");
}

describe("env validation", () => {
  beforeEach(() => {
    // Reset to a clean slate before each test
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    // Vitest sets these automatically — restore so loadEnv can opt out.
    // NODE_ENV is read-only on the TS process.env type; assign via Object.assign.
    if (ORIGINAL_ENV.VITEST) process.env.VITEST = ORIGINAL_ENV.VITEST;
    if (ORIGINAL_ENV.NODE_ENV) {
      Object.assign(process.env, { NODE_ENV: ORIGINAL_ENV.NODE_ENV });
    }
  });

  afterEach(() => {
    // Restore the original env so other test files aren't affected
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, ORIGINAL_ENV);
  });

  it("provides test defaults when VITEST is set", async () => {
    const { env } = await loadEnv({});
    expect(env.DATABASE_URL).toContain("postgresql://");
    expect(env.BETTER_AUTH_SECRET).toBeTruthy();
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
  });

  it("applies sensible defaults for optional vars", async () => {
    const { env } = await loadEnv({});
    expect(env.PASSKEY_RP_ID).toBe("localhost");
    expect(env.PLATFORM_NAME).toBe("RVLT Flow");
    expect(env.EMAIL_FROM).toBe("RVLT Flow <flow@rvlt.app>");
    expect(env.UPLOAD_MAX_SIZE_MB).toBe(50);
  });

  it("coerces UPLOAD_MAX_SIZE_MB from string to number", async () => {
    const { env } = await loadEnv({ UPLOAD_MAX_SIZE_MB: "100" });
    expect(env.UPLOAD_MAX_SIZE_MB).toBe(100);
    expect(typeof env.UPLOAD_MAX_SIZE_MB).toBe("number");
  });

  it("rejects non-URL values for NEXT_PUBLIC_APP_URL in production", async () => {
    await expect(
      loadEnv({
        VITEST: undefined,
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://x",
        BETTER_AUTH_SECRET: "s",
        BETTER_AUTH_URL: "https://app.example.com",
        NEXT_PUBLIC_APP_URL: "not-a-url",
      }),
    ).rejects.toThrow(/NEXT_PUBLIC_APP_URL/);
  });

  it("throws a structured error listing every missing required var", async () => {
    await expect(
      loadEnv({
        VITEST: undefined,
        NODE_ENV: "production",
        DATABASE_URL: undefined,
        BETTER_AUTH_SECRET: undefined,
        BETTER_AUTH_URL: undefined,
        NEXT_PUBLIC_APP_URL: undefined,
      }),
    ).rejects.toThrow(/DATABASE_URL[\s\S]*BETTER_AUTH_SECRET[\s\S]*BETTER_AUTH_URL[\s\S]*NEXT_PUBLIC_APP_URL/);
  });

  it("preserves user-supplied values over test defaults", async () => {
    const { env } = await loadEnv({
      DATABASE_URL: "postgresql://custom:5432/db",
      NEXT_PUBLIC_APP_URL: "https://myapp.test",
    });
    expect(env.DATABASE_URL).toBe("postgresql://custom:5432/db");
    expect(env.NEXT_PUBLIC_APP_URL).toBe("https://myapp.test");
  });

  it("leaves optional vars undefined when not set", async () => {
    const { env } = await loadEnv({});
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.CRON_SECRET).toBeUndefined();
  });
});
