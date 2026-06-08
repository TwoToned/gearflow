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
  // discord.js + its peers use Node-only APIs (`node:module`) and an optional
  // native compression dep (`zlib-sync`) that the client bundler can't resolve
  // statically. The in-process Discord bot loads them at runtime from
  // `src/lib/discord/bot-process.ts` (booted by `instrumentation.ts`).
  // Marking them as serverExternalPackages tells Next to leave them as
  // require()-at-runtime on the server and never trace them into client bundles.
  serverExternalPackages: [
    "discord.js",
    "@discordjs/ws",
    "@discordjs/rest",
    "@discordjs/builders",
    "@discordjs/collection",
    "zlib-sync",
    "@prisma/adapter-pg",
    "pg",
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
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
