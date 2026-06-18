# GearFlow PR Preview Environments Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Automatically create a short-lived GearFlow preview instance for each GitHub PR on Jayden's own server, with a PR-specific domain and matching Better Auth / app URLs, roughly emulating Vercel preview deployments without handing Vercel the keys to the kingdom.

**Architecture:** Use GitHub Actions on PR open/sync/reopen/close, a self-hosted runner on the server, Docker Compose per PR, Traefik or Caddy for wildcard HTTPS routing, and per-PR environment generation. Each preview runs an isolated app container, isolated Postgres database/schema, optionally isolated MinIO bucket/prefix, and connects to a shared or per-PR Convex dev deployment depending on what GearFlow needs once Convex lands in the repo.

**Tech Stack:** GitHub Actions, self-hosted runner, Docker/Compose, Caddy or Traefik, PostgreSQL, pnpm/Next.js, Prisma, Better Auth, Convex CLI/API, optional GitHub Deployments API.

---

## Current context discovered

- Repo: `/home/jayden/code/gearflow`
- App: Next.js 16, React 19, Prisma 7, Postgres, Better Auth.
- Existing production deploy workflow: `.github/workflows/main.yml` runs on `push` to `main` on a `self-hosted` runner, then `git pull`, `pnpm install`, `prisma generate`, tests, migrations, build, and `pm2 restart gearflow`.
- Existing CI workflow: `.github/workflows/ci.yml` runs lint/typecheck/test/build on PRs.
- Better Auth config uses:
  - `BETTER_AUTH_URL`
  - `NEXT_PUBLIC_APP_URL`
  - `PASSKEY_RP_ID`
  - `SSO_TRUSTED_ORIGINS`
  - `trustedOrigins` includes `env.NEXT_PUBLIC_APP_URL`
  - passkeys use `rpID: env.PASSKEY_RP_ID` and `origin: env.BETTER_AUTH_URL`
- Current dev DB compose: `docker-db/docker-compose.yml` only has Postgres and MinIO.
- No Convex package/files are currently in the checked repo, so Convex integration should be designed as an extension point, not hardcoded blindly yet.

---

## Recommended design: local Vercel clone, but boring

### Shape

For PR #123:

- URL: `https://pr-123.dev.gearflow.yourdomain.com`
- App container: `gearflow-pr-123-web`
- Database: `gearflow_pr_123` or container `gearflow-pr-123-postgres`
- MinIO bucket/prefix: `gearflow-pr-123`
- Network: `gearflow-preview`
- Env file: `/srv/gearflow-previews/pr-123/.env`
- Workdir/cache: `/srv/gearflow-previews/pr-123/source`
- Docker Compose project: `gearflow-pr-123`

Use wildcard DNS:

```txt
*.dev.gearflow.yourdomain.com -> server IP
```

Use Caddy or Traefik for TLS + reverse proxy. I prefer **Caddy** unless you want container label magic. Caddy is less clever, which is often a feature when you're the poor bastard debugging it at midnight.

---

## Option A — Docker Compose per PR, self-hosted GitHub Actions runner

This is the best first version.

### Flow

1. PR opens or updates.
2. GitHub Actions job runs on the self-hosted server.
3. Script computes preview identity:
   - `PR_NUMBER=123`
   - `PREVIEW_HOST=pr-123.dev.gearflow.example.com`
   - `PREVIEW_URL=https://pr-123.dev.gearflow.example.com`
4. Script checks out the PR SHA into `/srv/gearflow-previews/pr-123/source`.
5. Script writes `/srv/gearflow-previews/pr-123/.env` with PR-specific values.
6. Script builds app image or runs `pnpm install && pnpm build` inside a container.
7. Script starts/reloads Compose project `gearflow-pr-123`.
8. Script runs Prisma `db push` or `migrate deploy` against the preview DB.
9. Script hits `/api/health` or `/login` and fails the deployment if the app is not reachable.
10. Script comments the preview URL on the PR.
11. On PR close/merge, cleanup job removes containers/network/db/volumes/env files.

### Pros

- Closest to Vercel preview deployments.
- Cheap: uses your server.
- Clean rollback/cleanup story.
- Keeps production PM2 deployment separate.
- Easy to add `pr-123` metadata and TTL cleanup.

### Cons

- You own capacity, TLS, cleanup, Docker disk growth, and broken previews. Congrats, you're Vercel now, but with fewer employees.
- Needs careful secret handling on the self-hosted runner.

---

## Option B — One shared preview app, dynamically switches branch by PR

Do not do this unless the server is tiny.

Run only one preview at a time and redeploy it to the current PR.

### Pros

- Simpler infra.
- Lower memory/CPU.

### Cons

- Not actually Vercel-like.
- PRs stomp each other.
- QA links go stale whenever another PR updates.
- Bad ergonomics. Future-you will invent new swear words.

---

## Option C — Kubernetes/k3s + GitOps

Use k3s, ingress-nginx/Traefik, cert-manager, external-dns, per-PR namespaces.

### Pros

- Clean scalable architecture.
- True ephemeral environments.
- Easier isolation.

### Cons

- More moving pieces than GearFlow needs right now.
- You will spend two evenings arguing with YAML instead of shipping GearFlow.

Keep this as the v2 if previews become core infrastructure.

---

## Better Auth requirements

For each PR preview env, set:

```env
NEXT_PUBLIC_APP_URL=https://pr-123.dev.gearflow.example.com
BETTER_AUTH_URL=https://pr-123.dev.gearflow.example.com
SSO_TRUSTED_ORIGINS=https://pr-123.dev.gearflow.example.com
PASSKEY_RP_ID=pr-123.dev.gearflow.example.com
```

Important notes:

1. **Cookies:** Better Auth secure cookies should be fine on HTTPS subdomains.
2. **Passkeys/WebAuthn:** `rpID` is domain-sensitive. For preview domains, passkeys created on production will not work if `rpID` is the exact preview host. That is good for isolation. If you want one passkey across all previews and prod, use the registrable parent domain as RP ID, but only if all preview hosts live under the same site and you are comfortable widening the trust boundary.
3. **OAuth providers:** Google/Microsoft redirect URIs usually need exact callback URLs. Wildcards are often not accepted. For previews, either:
   - disable social login by omitting `GOOGLE_CLIENT_ID` / `MICROSOFT_CLIENT_ID`, or
   - use Better Auth email/password only, or
   - use a dev OAuth app and automate callback URL registration if the provider API supports it.
4. **SAML/OIDC customer SSO:** Don't run real customer SSO against preview URLs unless explicitly testing SSO. Use test IdPs.
5. **Email links:** `NEXT_PUBLIC_APP_URL` already feeds invitation URLs in `src/lib/auth.ts`, so PR-specific URLs should work once env is correct.

Recommended v1: previews support email/password and admin bootstrap only; social login/passkeys can be tested separately.

---

## Convex plan

Because Convex is not currently in the checked repo, design for two modes.

### Mode 1: Shared Convex dev deployment

All previews connect to one Convex dev deployment.

```env
NEXT_PUBLIC_CONVEX_URL=https://your-shared-dev.convex.cloud
CONVEX_DEPLOYMENT=dev:your-shared-dev
```

Add `PREVIEW_ID=pr-123` and require app data to partition by preview ID/tenant/org.

Pros:
- Very simple.
- Fast startup.
- Lower Convex admin surface.

Cons:
- Preview data can bleed unless app-level partitioning is flawless.
- Schema changes across PRs can conflict.

Use this only while Convex usage is light.

### Mode 2: Per-PR Convex deployment

On deploy:

```bash
npx convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
```

or equivalent Convex CLI flow once the project has Convex files. Store the generated deployment URL in the PR env file.

On cleanup, destroy/archive the deployment if Convex supports it through CLI/API.

Pros:
- Proper isolation.
- PR schema changes do not fight each other.

Cons:
- More automation.
- Need Convex token on self-hosted runner.
- Need cleanup discipline.

Recommended final state: per-PR Convex deployments if GearFlow's active data layer is moving there. Shared dev is acceptable as a temporary bootstrapping hack.

---

## Files to add/change

### Add

- `.github/workflows/preview.yml`
- `infra/previews/deploy-preview.sh`
- `infra/previews/destroy-preview.sh`
- `infra/previews/docker-compose.preview.yml`
- `infra/previews/Caddyfile.example` or `infra/previews/traefik-compose.yml`
- `infra/previews/env.example`
- `src/app/api/health/route.ts` if a reliable health endpoint does not exist
- `docs/preview-environments.md`

### Modify

- `src/env.ts`
  - Add/validate any preview-specific envs:
    - `PREVIEW_ID`
    - `PREVIEW_DOMAIN`
    - `CONVEX_DEPLOYMENT`
    - `NEXT_PUBLIC_CONVEX_URL`
- `src/lib/auth.ts`
  - Possibly make passkey plugin conditional if `PASSKEY_RP_ID` is unset in previews.
  - Consider adding preview origin parsing if you want wildcard trust, but explicit env is safer.
- `README.md`
  - Link preview docs.

---

## Skeleton GitHub workflow

```yaml
name: Preview Deploy

on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

concurrency:
  group: preview-pr-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  deploy:
    if: github.event.action != 'closed'
    runs-on: self-hosted
    permissions:
      contents: read
      pull-requests: write
      deployments: write
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}

      - name: Deploy preview
        env:
          PR_NUMBER: ${{ github.event.pull_request.number }}
          PR_SHA: ${{ github.event.pull_request.head.sha }}
          PREVIEW_BASE_DOMAIN: ${{ vars.PREVIEW_BASE_DOMAIN }}
          BETTER_AUTH_SECRET: ${{ secrets.PREVIEW_BETTER_AUTH_SECRET }}
          CONVEX_DEPLOY_KEY: ${{ secrets.CONVEX_DEPLOY_KEY }}
        run: bash infra/previews/deploy-preview.sh

      - name: Comment preview URL
        uses: actions/github-script@v7
        with:
          script: |
            const pr = context.payload.pull_request.number;
            const url = `https://pr-${pr}.${process.env.PREVIEW_BASE_DOMAIN}`;
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: pr,
              body: `Preview: ${url}`,
            });
        env:
          PREVIEW_BASE_DOMAIN: ${{ vars.PREVIEW_BASE_DOMAIN }}

  destroy:
    if: github.event.action == 'closed'
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      - name: Destroy preview
        env:
          PR_NUMBER: ${{ github.event.pull_request.number }}
        run: bash infra/previews/destroy-preview.sh
```

---

## Skeleton compose

```yaml
services:
  web:
    image: gearflow-preview:${PR_NUMBER}
    container_name: gearflow-pr-${PR_NUMBER}-web
    restart: unless-stopped
    env_file:
      - .env
    networks:
      - gearflow-preview
    depends_on:
      - db

  db:
    image: postgres:17-alpine
    container_name: gearflow-pr-${PR_NUMBER}-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: gearflow_pr_${PR_NUMBER}
    volumes:
      - gearflow-pr-${PR_NUMBER}-pg:/var/lib/postgresql/data
    networks:
      - gearflow-preview

volumes:
  gearflow-pr-${PR_NUMBER}-pg:

networks:
  gearflow-preview:
    external: true
```

If using Caddy, either:

1. generate a Caddyfile block per PR and reload Caddy, or
2. run `caddy-docker-proxy` and use Docker labels.

For v1, generated Caddyfile is dead simple and inspectable.

---

## Deployment script outline

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${PR_NUMBER:?missing PR_NUMBER}"
: "${PREVIEW_BASE_DOMAIN:?missing PREVIEW_BASE_DOMAIN}"
: "${BETTER_AUTH_SECRET:?missing BETTER_AUTH_SECRET}"

PREVIEW_HOST="pr-${PR_NUMBER}.${PREVIEW_BASE_DOMAIN}"
PREVIEW_URL="https://${PREVIEW_HOST}"
ROOT="/srv/gearflow-previews/pr-${PR_NUMBER}"

mkdir -p "$ROOT"

cat > "$ROOT/.env" <<EOF
NODE_ENV=production
PREVIEW_ID=pr-${PR_NUMBER}
DATABASE_URL=postgresql://postgres:postgres@db:5432/gearflow_pr_${PR_NUMBER}
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
BETTER_AUTH_URL=${PREVIEW_URL}
NEXT_PUBLIC_APP_URL=${PREVIEW_URL}
SSO_TRUSTED_ORIGINS=${PREVIEW_URL}
PASSKEY_RP_ID=${PREVIEW_HOST}
EOF

docker network inspect gearflow-preview >/dev/null 2>&1 || docker network create gearflow-preview

docker build -t gearflow-preview:${PR_NUMBER} .

docker compose \
  --project-name gearflow-pr-${PR_NUMBER} \
  --env-file "$ROOT/.env" \
  -f infra/previews/docker-compose.preview.yml \
  up -d --remove-orphans

docker compose \
  --project-name gearflow-pr-${PR_NUMBER} \
  --env-file "$ROOT/.env" \
  -f infra/previews/docker-compose.preview.yml \
  exec -T web pnpm exec prisma db push

curl -fsS "${PREVIEW_URL}/api/health"
```

Exact script needs adjustment based on final Dockerfile/build strategy.

---

## Cleanup script outline

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${PR_NUMBER:?missing PR_NUMBER}"
ROOT="/srv/gearflow-previews/pr-${PR_NUMBER}"

if [ -f "$ROOT/.env" ]; then
  docker compose \
    --project-name gearflow-pr-${PR_NUMBER} \
    --env-file "$ROOT/.env" \
    -f infra/previews/docker-compose.preview.yml \
    down -v --remove-orphans
fi

rm -rf "$ROOT"
docker image rm gearflow-preview:${PR_NUMBER} || true
```

Add a nightly TTL cleanup later for previews older than e.g. 14 days where the PR is closed or missing.

---

## Required server setup

1. Install Docker + Compose plugin.
2. Install GitHub self-hosted runner as a locked-down user.
3. Add wildcard DNS record for preview subdomain.
4. Install and configure Caddy/Traefik with automatic HTTPS.
5. Create `/srv/gearflow-previews` owned by runner user.
6. Set GitHub repo vars:
   - `PREVIEW_BASE_DOMAIN=dev.gearflow.example.com`
   - `APP_DIR` remains production only.
7. Set GitHub secrets:
   - `PREVIEW_BETTER_AUTH_SECRET`
   - `CONVEX_DEPLOY_KEY` once Convex integration exists
   - optional preview email/S3/etc secrets
8. Add a server firewall rule: only 80/443 public; no raw preview DB ports exposed.

---

## Validation checklist

- Open a test PR.
- Confirm Actions creates deployment successfully.
- Confirm PR comment contains `https://pr-N.dev...`.
- Visit preview URL over HTTPS.
- Sign up first user.
- Confirm first user auto-promotes to admin.
- Confirm session cookie is scoped to preview host.
- Confirm invite/reset URLs use preview URL.
- Confirm passkey behavior is either disabled or preview-host-specific.
- Push another commit to the PR and confirm deployment updates in-place.
- Close PR and confirm containers/volumes/files are destroyed.
- Reopen PR and confirm fresh preview is recreated.

---

## Main risks

1. **Secrets on self-hosted runner:** PRs from forks are dangerous. Do not expose preview deploy secrets to forked PRs. Restrict preview deploy to branches in the same repo or require manual approval.
2. **Resource leaks:** Docker volumes/images will grow forever without cleanup. Add TTL janitor.
3. **OAuth redirect URLs:** Dynamic preview domains rarely work cleanly with Google/Microsoft. Disable social auth in previews unless actively testing it.
4. **Convex schema conflicts:** Shared Convex dev deployment is fine short-term, bad long-term once schema evolves per PR.
5. **Database migrations:** `prisma migrate deploy` is more prod-like; `prisma db push` is more forgiving for throwaway previews. Given existing CI comments say migrations are not replayable from scratch, use `prisma db push` for previews unless the migration history gets fixed.
6. **Production contamination:** Keep preview Compose/network/env completely separate from PM2 production deploy.

---

## My recommended implementation order

1. Add Caddy/Traefik and wildcard DNS manually on server.
2. Add Dockerfile for GearFlow production-ish app if missing.
3. Add `src/app/api/health/route.ts`.
4. Add `infra/previews/docker-compose.preview.yml`.
5. Add `deploy-preview.sh` using static env, no Convex automation yet.
6. Add `destroy-preview.sh`.
7. Add `.github/workflows/preview.yml` for same-repo PRs only.
8. Test with one PR.
9. Add PR comments/deployment status.
10. Add TTL cleanup cron.
11. Add Convex per-PR deployment once Convex files are actually present.

---

## Opinionated call

Build **Option A** now: Compose-per-PR behind Caddy, same self-hosted runner, same-repo PRs only, preview auth via email/password, `prisma db push`, and Convex integration as a second pass.

That gives you 80% of Vercel previews without adopting Kubernetes as a personality disorder.
