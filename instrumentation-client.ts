import * as Sentry from "@sentry/nextjs";

// Client-side Sentry init. Loaded automatically by Next.js when this file
// exists at the project root. DSN is optional — if unset, init no-ops.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,

    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

    // Internal back-office app — no session replay (no client-side PII capture)
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    ignoreErrors: [
      // Next.js framework signals
      "NEXT_NOT_FOUND",
      "NEXT_REDIRECT",
      // React-Query aborts
      "AbortError",
      // ResizeObserver loop limit — benign, fires on legitimate UI work
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
      // Browser-extension noise
      /^Non-Error promise rejection captured/,
    ],

    beforeSend(event) {
      // Strip URL fragments/queries that might leak PII before send
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
      }
      return event;
    },
  });
}

// Required export for Next.js 16+ client-side router transition spans
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
