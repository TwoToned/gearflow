import * as Sentry from "@sentry/nextjs";

// Edge runtime (middleware, edge route handlers). Same DSN as server.
const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    ignoreErrors: ["NEXT_NOT_FOUND", "NEXT_REDIRECT", "APIError", "AbortError"],
  });
}
