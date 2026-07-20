FROM node:22-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3
WORKDIR /app

# curl: required by Coolify's container health check (slim has neither curl nor wget)
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@11.7.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .

# ── Build-time env ────────────────────────────────────────────────────────────
# Only NEXT_PUBLIC_* are INLINED into the client bundle at `next build`, so those
# must be REAL values (passed as build args by the CI workflow). Everything else
# is read from the container's runtime env (set in Coolify), so we only need
# placeholders here to satisfy env.ts validation during the build — the real
# values arrive at runtime and win. Migrations do NOT run here (the CI runner
# can't reach the prod DB); they run in docker-entrypoint.sh at container start.

# Server-only vars — placeholders at build, real values injected at runtime.
ARG DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ARG BETTER_AUTH_SECRET="placeholder-build-only-secret"
ARG BETTER_AUTH_URL="https://placeholder.invalid"

# NEXT_PUBLIC_* — inlined into the JS bundle, MUST be real (from CI build args).
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_CONVEX_URL
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ARG NEXT_PUBLIC_GOOGLE_CONFIGURED
ARG NEXT_PUBLIC_MICROSOFT_CONFIGURED
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SITE_ADMIN_REG_ENABLED
# PostHog analytics — public write-only key, inlined into the client bundle so
# the browser SDK initialises in prod. Setting these only at runtime (Coolify)
# would NOT reach the already-built bundle.
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST

ENV DATABASE_URL=$DATABASE_URL \
    BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET \
    BETTER_AUTH_URL=$BETTER_AUTH_URL \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_CONVEX_URL=$NEXT_PUBLIC_CONVEX_URL \
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY \
    NEXT_PUBLIC_GOOGLE_CONFIGURED=$NEXT_PUBLIC_GOOGLE_CONFIGURED \
    NEXT_PUBLIC_MICROSOFT_CONFIGURED=$NEXT_PUBLIC_MICROSOFT_CONFIGURED \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_SITE_ADMIN_REG_ENABLED=$NEXT_PUBLIC_SITE_ADMIN_REG_ENABLED \
    NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST

# Prisma client (codegen only — no DB access) + Next production build.
RUN pnpm exec prisma generate && pnpm run build

EXPOSE 3000

# Entrypoint runs `prisma migrate deploy` against the RUNTIME DATABASE_URL (set
# in Coolify, reachable from inside the network) before starting the server.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["pnpm", "start"]
