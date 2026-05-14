import * as Sentry from "@sentry/nextjs";

// Sentry is optional — if DSN is unset, init silently no-ops so the app
// runs fine in dev / local without an external service.
const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE,

    // Performance: 10% sample in prod, full in dev (low traffic = low cost)
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

    // Framework noise: these are control-flow signals, not errors
    ignoreErrors: [
      "NEXT_NOT_FOUND",
      "NEXT_REDIRECT",
      // Better-Auth control-flow throws
      "APIError",
      // Aborted fetches from React Query cancellation
      "AbortError",
    ],

    // PII scrubbing — strip user email/IP before send
    beforeSend(event) {
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
      }
      // Strip the Authorization header from any captured request context
      if (event.request?.headers) {
        delete event.request.headers["authorization"];
        delete event.request.headers["cookie"];
      }
      return event;
    },

    // Internal back-office app — no session replay
  });
}
