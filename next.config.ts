import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";
import { withPostHogConfig } from "@posthog/nextjs-config";

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
  // by default. Has no effect on production builds. "host.docker.internal" is
  // needed by the self-hosted Convex container (docs/e2e-harness.md) to fetch
  // /api/auth/jwks from the host's `next dev` — without it every request from
  // the container 404s (Host header doesn't match the allow-list) and every
  // harness sign-up/sign-in fails with InvalidAuthHeader.
  allowedDevOrigins: ["roger", "host.docker.internal"],
  // Keep the Postgres driver as require()-at-runtime on the server so Next never
  // traces it into client bundles.
  serverExternalPackages: [
    "@prisma/adapter-pg",
    "pg",
  ],
  async headers() {
    // Content-Security-Policy — POLICY.md R-8.11.2, two headers (R-8.11.2 §15 exception
    // in docs/exceptions.md):
    //
    // 1) ENFORCED (`Content-Security-Policy`) — the zero-breakage-risk subset. It sets
    //    NO restrictive `default-src`, so it only *blocks* what the app never legitimately
    //    uses: cross-origin `<base>` (base-uri), `<object>/<embed>` (object-src), and being
    //    framed (frame-ancestors, mirroring the enforced X-Frame-Options: DENY). These
    //    can't break the known stack, so they're safe to enforce today.
    // 2) REPORT-ONLY (`…-Report-Only`) — the full target policy. Its script/style
    //    `'unsafe-inline'`, `form-action`, and `frame-src` directives can't be enforced
    //    yet without risking SAML SSO (auto-POST to the IdP) and the Google Maps iframes,
    //    and no violation-collection endpoint has confirmed the allowlist. It stays
    //    report-only until those are validated + the inline allowances are noncified.
    const cspEnforced = [
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
    ].join("; ");
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
      "connect-src 'self' https://*.convex.cloud wss://*.convex.cloud https://maps.googleapis.com https://*.i.posthog.com https://*.posthog.com",
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
            key: "Content-Security-Policy",
            value: cspEnforced,
          },
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

// PostHog MUST wrap outermost: anything wrapping it after (e.g. withPWA) would
// return a plain object and drop PostHog's build hooks — no sourcemap upload, no
// warning either (see github.com/PostHog/posthog-js/issues/3572).
//
// sourcemaps.enabled is gated on POSTHOG_SOURCEMAPS_REQUIRED, a flag only the
// production Dockerfile sets (never in local dev or the PR-validation `Build`
// job in ci.yml, which run `next build`/`next dev` without deploy creds). When
// it's on, resolveConfig() throws synchronously if POSTHOG_CLI_TOKEN /
// POSTHOG_CLI_ENV_ID are missing — a hard build failure, not a silent skip
// (R-8.9.2: the old Sentry setup depended on env vars that were never actually
// wired into the deploy pipeline, so its sourcemap upload silently never ran).
export default withPostHogConfig(withPWA(nextConfig), {
  personalApiKey: process.env.POSTHOG_CLI_TOKEN ?? "",
  projectId: process.env.POSTHOG_CLI_ENV_ID,
  host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  sourcemaps: {
    enabled: process.env.POSTHOG_SOURCEMAPS_REQUIRED === "true",
    releaseName: "rvlt-flow",
    releaseVersion: process.env.POSTHOG_RELEASE_VERSION,
    deleteAfterUpload: true,
  },
});
