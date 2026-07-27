/**
 * Environment variable validation.
 *
 * Parsed and validated at module load. Missing required vars throw a single
 * clear error listing every problem at once, so a misconfigured deploy fails
 * loudly at boot rather than silently producing wrong behavior at runtime.
 *
 * Server code should import { env } from "@/env" instead of reading process.env.
 * Client components keep reading process.env.NEXT_PUBLIC_* directly — Next.js
 * inlines those at build time.
 */

import { z } from "zod";
import { logger } from "@/lib/logger";

const serverEnvSchema = z.object({
  // Core (required)
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  BETTER_AUTH_SECRET: z.string().min(1, "BETTER_AUTH_SECRET is required"),
  BETTER_AUTH_URL: z.string().url("BETTER_AUTH_URL must be a valid URL"),

  // DB connection hardening (see src/lib/db-url.ts). Defaults are safe for a
  // single-node Postgres; tune per-box. statement_timeout is the key stability
  // guard — it stops one slow query from holding a pooled connection and
  // stalling the whole app. Set DB_STATEMENT_TIMEOUT_MS=0 to disable (not advised).
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(30000),
  DB_POOL_TIMEOUT_S: z.coerce.number().int().nonnegative().default(10),
  // Omit to keep Prisma's cpu-based default (cpus * 2 + 1).
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().optional(),

  // Runtime
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Auth / branding
  PASSKEY_RP_ID: z.string().default("localhost"),
  PLATFORM_NAME: z.string().default("RVLT Flow"),

  // Email (optional — logs to console if unset)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("RVLT Flow <flow@rvlt.app>"),
  // Phase 6b flag — see src/lib/native-writes.ts. Read directly via process.env
  // there (not via `env.NATIVE_EMAIL_SIDEEFFECTS`) so the schema's only job is
  // catching a typo'd/undocumented var name; the boolean coercion stays local
  // to the call site.
  NATIVE_EMAIL_SIDEEFFECTS: z.string().optional(),

  // (File storage moved to Convex `_storage`; the S3/Garage env vars were removed.)

  // Admin registration (legacy + new names — code references both)
  ADMIN_REGISTRATION_TOKEN: z.string().optional(),
  SITE_ADMIN_SECRET_TOKEN: z.string().optional(),
  SITE_ADMIN_REGISTRATION_ENABLED: z.string().optional(),

  // SSO
  SSO_TRUSTED_ORIGINS: z.string().optional(),

  // Uploads
  UPLOAD_MAX_SIZE_MB: z.coerce.number().int().positive().default(50),

  // Cron / scheduled jobs
  CRON_SECRET: z.string().optional(),

  // Xero integration (WS1 #940) — optional; the OAuth connect flow throws a
  // clear error at click-time if unset rather than gating the whole app boot
  // (no org may have connected Xero yet, and never connecting is a valid
  // steady state — see FEATUREDOCS/66-finance-quotes-invoices-xero.md).
  XERO_CLIENT_ID: z.string().optional(),
  XERO_CLIENT_SECRET: z.string().optional(),
  // Defaults to `${NEXT_PUBLIC_APP_URL}/api/integrations/xero/callback` when unset.
  XERO_REDIRECT_URI: z.string().url().optional(),

  // Convex data layer (see FEATUREDOCS/54-convex-data-layer.md).
  // Optional during the migration so the app boots without Convex configured;
  // a domain only depends on Convex once its phase lands. Server actions read
  // the self-hosted URL + admin key to call mutations via convex/nextjs.
  CONVEX_SELF_HOSTED_URL: z
    .string()
    .url("CONVEX_SELF_HOSTED_URL must be a valid URL")
    .optional(),
  CONVEX_SELF_HOSTED_ADMIN_KEY: z.string().optional(),
  // Browser client target (Convex WebSocket). NEXT_PUBLIC_* is inlined at build.
  NEXT_PUBLIC_CONVEX_URL: z
    .string()
    .url("NEXT_PUBLIC_CONVEX_URL must be a valid URL")
    .optional(),
  NEXT_PUBLIC_CONVEX_SITE_URL: z
    .string()
    .url("NEXT_PUBLIC_CONVEX_SITE_URL must be a valid URL")
    .optional(),

  // PostHog — error tracking sourcemap upload (deploy pipeline only; see
  // next.config.ts). Optional here since sourcemaps.enabled itself is gated
  // on POSTHOG_SOURCEMAPS_REQUIRED, not on these being present.
  POSTHOG_CLI_TOKEN: z.string().optional(),
  POSTHOG_CLI_ENV_ID: z.string().optional(),
  POSTHOG_RELEASE_VERSION: z.string().optional(),

  // Public — duplicated in clientEnv for typed access on server too
  NEXT_PUBLIC_APP_URL: z.string().url("NEXT_PUBLIC_APP_URL must be a valid URL"),
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: z.string().optional(),
  NEXT_PUBLIC_SITE_ADMIN_REG_ENABLED: z.string().optional(),
});

// In Vitest, process.env.VITEST is set automatically. Provide test-only defaults
// for the required vars so unit tests can import modules that depend on env
// (prisma, auth, etc.) without each test having to construct an env fixture.
// Integration tests against a real database still need DATABASE_URL set explicitly.
const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
const envSource: NodeJS.ProcessEnv = isTest
  ? {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/gearflow_test",
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "test-secret-not-for-production",
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      NODE_ENV: process.env.NODE_ENV ?? "test",
    }
  : process.env;

const validated = serverEnvSchema.safeParse(envSource);

if (!validated.success) {
  const issues = validated.error.issues
    .map((issue) => `  • ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  throw new Error(
    `\n\n❌ Invalid environment configuration:\n${issues}\n\n` +
      `Check your .env file against CLAUDE.md for required variables.\n`,
  );
}

const parsed = validated.data;

// Warn on missing optional config rather than hard-fail
if (parsed.NODE_ENV !== "test") {
  if (!parsed.RESEND_API_KEY) {
    logger.warn(
      "[env] RESEND_API_KEY is not set — emails will log to console instead of being sent.",
    );
  }
}

export const env = parsed;
export type Env = typeof env;
