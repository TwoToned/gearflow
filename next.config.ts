import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";
import { withSentryConfig } from "@sentry/nextjs";

const withPWA = withPWAInit({
  dest: "public",
  register: true,
  disable: process.env.NODE_ENV === "development",
  fallbacks: {
    document: "/offline",
  },
});

const nextConfig: NextConfig = {
  // Turbopack config (Next.js 16 default bundler)
  turbopack: {},
  // Dev-only: allow HMR / dev-resource access when the app is reached via the
  // box hostname (not just localhost). Next 16 blocks cross-origin dev requests
  // by default. Has no effect on production builds.
  allowedDevOrigins: ["roger"],
  // Keep the Postgres driver as require()-at-runtime on the server so Next never
  // traces it into client bundles.
  serverExternalPackages: [
    "@prisma/adapter-pg",
    "pg",
  ],
  async headers() {
    // Content-Security-Policy — POLICY.md R-8.11.2. Shipped in REPORT-ONLY first
    // (the policy's "report-only then enforce" rollout): browsers report violations
    // but never block, so this cannot break the app. This is the *target* policy for
    // the known stack (Next, Sentry, Google Maps, Convex, PWA worker); observe reports
    // in prod, tighten the two `'unsafe-inline'` allowances (Next inline bootstrap +
    // Tailwind styles) toward nonces, then promote the key to `Content-Security-Policy`.
    // `frame-ancestors 'none'` mirrors the enforced `X-Frame-Options: DENY` above.
    const cspReportOnly = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self' 'unsafe-inline' https://maps.googleapis.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.convex.cloud https://maps.gstatic.com https://maps.googleapis.com https://*.googleusercontent.com",
      "font-src 'self' data:",
      "connect-src 'self' https://*.convex.cloud wss://*.convex.cloud https://*.sentry.io https://*.ingest.sentry.io https://maps.googleapis.com",
      "frame-src 'self'",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          {
            key: "Content-Security-Policy-Report-Only",
            value: cspReportOnly,
          },
          // HSTS (POLICY.md R-8.11.2). 1-year max-age, scoped to this host only —
          // deliberately NO includeSubDomains / preload until every rvlt.app
          // subdomain is confirmed HTTPS-only. Browsers ignore this over plain
          // HTTP (local dev), so it's inert outside production.
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

// Sentry wraps last so it can instrument the fully-composed config.
// Source-map upload only runs in CI (SENTRY_AUTH_TOKEN must be set).
export default withSentryConfig(withPWA(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Silent in CI logs (Sentry's progress output is noisy)
  silent: !process.env.CI,
  // Hide source maps from client bundles after upload to Sentry
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
  // Disable Sentry's logger on startup
  disableLogger: true,
});
