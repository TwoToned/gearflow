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
  PLATFORM_NAME: z.string().default("GearFlow"),

  // Email (optional — logs to console if unset)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("GearFlow <noreply@gearflow.app>"),

  // S3 / storage (optional, defaults match storage.ts behavior)
  S3_REGION: z.string().default("ap-southeast-2"),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),
  S3_BUCKET: z.string().default("gearflow-uploads"),
  S3_ENDPOINT: z.string().optional(),

  // OAuth — both client id + secret must be set together
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),

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

  // Convex (hybrid migration — see docs/designs/convex-hybrid-migration.md).
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

  // Discord bot — RUNS IN-PROCESS NOW. All credentials and config live in the
  // DiscordIntegration row (encrypted token via secret-vault). No bot env vars
  // here; instrumentation.ts boots it on server start.

  // Sentry — error tracking. If unset, Sentry is disabled (dev/local).
  SENTRY_DSN: z.string().optional(),
  // Source map upload (CI only)
  SENTRY_AUTH_TOKEN: z.string().optional(),
  SENTRY_ORG: z.string().optional(),
  SENTRY_PROJECT: z.string().optional(),
  // Release identifier — usually set by CI (git SHA)
  SENTRY_RELEASE: z.string().optional(),

  // Public — duplicated in clientEnv for typed access on server too
  NEXT_PUBLIC_APP_URL: z.string().url("NEXT_PUBLIC_APP_URL must be a valid URL"),
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: z.string().optional(),
  NEXT_PUBLIC_GOOGLE_CONFIGURED: z.string().optional(),
  NEXT_PUBLIC_MICROSOFT_CONFIGURED: z.string().optional(),
  NEXT_PUBLIC_SITE_ADMIN_REG_ENABLED: z.string().optional(),
  // Sentry — client-side DSN (separate from server DSN by Next convention)
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
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

// Pair checks — warn on partial OAuth config rather than hard-fail (legacy data)
if (parsed.NODE_ENV !== "test") {
  if (parsed.GOOGLE_CLIENT_ID && !parsed.GOOGLE_CLIENT_SECRET) {
    // eslint-disable-next-line no-console
    console.warn(
      "[env] GOOGLE_CLIENT_ID is set but GOOGLE_CLIENT_SECRET is not — Google OAuth will not initialize.",
    );
  }
  if (parsed.MICROSOFT_CLIENT_ID && !parsed.MICROSOFT_CLIENT_SECRET) {
    // eslint-disable-next-line no-console
    console.warn(
      "[env] MICROSOFT_CLIENT_ID is set but MICROSOFT_CLIENT_SECRET is not — Microsoft OAuth will not initialize.",
    );
  }
  if (!parsed.RESEND_API_KEY) {
    // eslint-disable-next-line no-console
    console.warn(
      "[env] RESEND_API_KEY is not set — emails will log to console instead of being sent.",
    );
  }
}

export const env = parsed;
export type Env = typeof env;
