# 56 — Production Deployment (GitHub → GHCR → Coolify)

Production runs on a **DigitalOcean droplet managed by Coolify**, serving a
**prebuilt container image**. The image is built on **GitHub Actions** (16GB
runners) and pushed to **GHCR**; Coolify pulls and runs it. This replaced the
old self-hosted pm2 deploy (`main.yml`), which OOM-killed `next build` on the
small droplet (exit 137).

- **Production URL:** https://gearflow.prod.rvlt.app
- **Build/deploy workflow:** `.github/workflows/build-image.yml` (push to `main`)
- **Image:** `ghcr.io/twotoned/gearflow:latest` (+ a `:<sha>` tag per build)
- **Backend:** Convex Cloud (prod deployment) + PostgreSQL/Prisma + Garage (S3)

## Why build off-box

`next build` needs ~4GB RAM. The prod droplet has less, so building on it gets
OOM-killed (`exit code 137`, `Killed`). Building on GitHub's runners removes that
constraint entirely and makes the **repo Dockerfile the single source of truth**
(previously prod built from a hand-edited Dockerfile pasted into Coolify's UI).

## The pipeline (`build-image.yml`)

On every push to `main`:

1. **Checkout** with `fetch-depth: 0` (full history for the changelog).
2. **Generate build info** — `node scripts/generate-build-info.mjs` writes
   `build-info.json` (commit hash, count, changelog) into the build context. The
   container has no `.git`, so the changelog UI reads this baked file. See
   [Changelog / version](#changelog--version).
3. **Deploy Convex functions** (`convex deploy`) — pushes functions + schema to
   the **prod** Convex Cloud deployment. This is a **gate**: a broken schema
   fails here before any image is built or shipped. Needs `CONVEX_DEPLOY_KEY`.
4. **Build + push** the image to GHCR (`docker/build-push-action`), with the
   GitHub Actions layer cache (`cache-from/to: type=gha`).
5. **Trigger Coolify** — `GET` the authed deploy webhook so Coolify pulls + runs
   the new image.

## Dockerfile design

`Dockerfile` (repo root), base `node:22-slim`. Key decisions:

- **`curl` is installed** — `node:22-slim` ships neither `curl` nor `wget`, and
  Coolify's container health check needs one of them.
- **pnpm store cache mount** speeds up repeat installs.
- **Migrations do NOT run at build time.** The CI runner can't reach the internal
  prod DB. Instead `docker-entrypoint.sh` runs `prisma migrate deploy` at
  container start (from inside the network, where the DB is reachable), then
  starts the app. `migrate deploy` only applies committed migrations and is a
  no-op when up to date, so it's safe on every start.
- **Server secrets are build-only placeholders.** Only `NEXT_PUBLIC_*` are
  inlined into the client bundle at `next build`, so those are passed as **real**
  build args. `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` get
  placeholder values during the build (enough to satisfy `src/env.ts`
  validation); the **real** values come from Coolify's runtime env and win.

### Build args (set as GitHub repo variables/secrets)

Inlined `NEXT_PUBLIC_*` (must be **real prod** values):

| Source | Name |
|---|---|
| variable | `NEXT_PUBLIC_APP_URL` = `https://gearflow.prod.rvlt.app` |
| variable | `NEXT_PUBLIC_CONVEX_URL` = the **prod** Convex URL |
| secret | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` |
| variable | `NEXT_PUBLIC_GOOGLE_CONFIGURED`, `NEXT_PUBLIC_MICROSOFT_CONFIGURED` |
| variable | `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SITE_ADMIN_REG_ENABLED` (optional) |

Workflow secrets: `CONVEX_DEPLOY_KEY` (prod), `COOLIFY_DEPLOY_WEBHOOK`,
`COOLIFY_TOKEN`.

## Coolify setup (one-time)

1. Create a **Docker Image** resource (NOT a git/Dockerfile/Compose build — those
   build on the droplet and re-introduce the OOM). Image:
   `ghcr.io/twotoned/gearflow:latest`.
2. **Registry credentials** — GHCR images are **private by default**, so Coolify
   needs auth to pull. Easiest, version-proof: `docker login` on the droplet:
   ```bash
   echo "<PAT_with_read:packages>" | sudo docker login ghcr.io -u <github-username> --password-stdin
   ```
   (Use your **personal** GitHub username, not the `TwoToned` org.) Cached to
   `/root/.docker/config.json`, which is the daemon Coolify uses.
3. **Runtime env vars** — set ALL real secrets in Coolify (they are no longer
   baked into the image): `DATABASE_URL`, `BETTER_AUTH_SECRET`,
   `BETTER_AUTH_URL` (= `https://gearflow.prod.rvlt.app`), `S3_*`,
   `RESEND_API_KEY`, `CONVEX_SELF_HOSTED_*`/Convex keys, etc.
4. **Health check** — path `/`, port `3000` (root 307-redirects to `/login`).
5. **Deploy webhook** — Coolify app → Webhooks → "Deploy Webhook (auth
   required)". Its URL is the `COOLIFY_DEPLOY_WEBHOOK` secret; the bearer token
   (Coolify → Keys & Tokens → API, `deploy` scope) is `COOLIFY_TOKEN`. The
   workflow calls it as `GET` with `Authorization: Bearer <token>`.

## Convex prod auth bridge

The prod Convex deployment validates Better Auth JWTs via `convex/auth.config.ts`
(a `customJwt` provider). It must trust the issuer the app stamps on tokens
(`iss` = the app's `BETTER_AUTH_URL`). Set these **on the prod Convex deployment**
(Convex dashboard → Settings → Environment Variables), then **redeploy Convex**
(the config snapshots the issuer at deploy time):

```
CONVEX_AUTH_ISSUER   = https://gearflow.prod.rvlt.app
CONVEX_AUTH_JWKS_URL = https://gearflow.prod.rvlt.app/api/auth/jwks
```

`CONVEX_AUTH_ISSUER` **must exactly equal** Coolify's `BETTER_AUTH_URL` (no
trailing slash). If they differ, every authed query fails with
`NoAuthProvider: No auth provider found matching the given token` — for BOTH
password and SSO logins (they share the same issuer). Unlike local/self-hosted,
the JWKS URL is publicly reachable in prod, so no `host.docker.internal` hack.

## Manual data migrations (runbook)

The old `migrate.yml` (manual data-migration workflow) targeted the self-hosted
runner and was **retired** with it. Run these scripts from the **Coolify
container terminal** instead (app → Terminal):

```bash
cd /app
# Call tsx directly — the npm scripts use `--env-file=.env`, but the container
# has no .env file (Coolify injects env into the process directly).
pnpm exec tsx scripts/collapse-historic-splits.ts            # dry-run
pnpm exec tsx scripts/collapse-historic-splits.ts --apply    # apply
```

Available scripts: `collapse-historic-splits.ts`, `collapse-split-siblings.ts`,
`migrate-docket-per-unit.ts`, `backfill-line-item-units.ts`. Each defaults to a
dry run; pass `--apply` to mutate. Convex backfills are separate one-time ops
(`scripts/convex-backfill-*.ts`).

## Changelog / version

The container has no `.git` and `node:22-slim` has no `git` binary, so
`src/server/changelog.ts` reads a baked `build-info.json` (commit hash, count,
changelog), generated in CI by `scripts/generate-build-info.mjs`. Local dev has
no `build-info.json` but does have `.git`, so it falls back to git there. If
neither exists the UI shows `unknown` / an empty changelog (harmless — the
`git: not found` line in container logs is this fallback firing and is caught).

## File storage — Garage (S3-compatible)

Uploads go to **Garage**, a self-hosted S3-compatible store running in Coolify.
`src/lib/storage.ts` auto-sets `forcePathStyle: true` when `S3_ENDPOINT` is set
(required for Garage). Files are served via the app's `/api/files/<key>` proxy,
so no public Garage URL is needed.

### Bootstrapping a fresh Garage node

The Garage container has **no shell**, so run the binary directly via
`docker exec`. A fresh node has no storage layout (first S3 call errors with
`Layout not ready`):

```bash
sudo docker exec garage /garage status              # note the node ID
sudo docker exec garage /garage layout assign -z dc1 -c 100G <node-id>
sudo docker exec garage /garage layout apply --version 1
sudo docker exec garage /garage bucket create gearflow-uploads
sudo docker exec garage /garage key create gearflow-app-key   # save the secret
sudo docker exec garage /garage bucket allow --read --write --owner gearflow-uploads --key <key-id>
```

App env: `S3_ENDPOINT` = Garage S3 API URL, `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`
= the key pair, `S3_BUCKET` = `gearflow-uploads`, `S3_REGION` = `garage`.
`S3_PUBLIC_URL` is not needed.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Build `exit code 137` / `Killed` | OOM. Building on the droplet — must build on GitHub (this workflow). |
| Coolify `unauthorized` / `manifest unknown` on pull; site 503 | GHCR image is private and Coolify has no creds → `docker login ghcr.io` on the droplet. |
| `NoAuthProvider: No auth provider found matching the given token` | Prod Convex `CONVEX_AUTH_ISSUER` ≠ app `BETTER_AUTH_URL`. Fix the env var + redeploy Convex. |
| `git: not found` in logs | Harmless — changelog git fallback firing; caught. |
| Build fails collecting page data on a DB call | A route hits the DB during prerender with the placeholder `DATABASE_URL`. Mark it `force-dynamic` or pass a real DB at build. |

## Local dev against shared dev Convex

To develop locally against the shared dev Convex without waiting for a deploy,
see `.env.local.example` (the "lie about the domain" auth bridge). Push Convex
function edits with `pnpm exec convex dev --once`.

## Related files

- `.github/workflows/build-image.yml` — build + deploy
- `Dockerfile`, `docker-entrypoint.sh` — image + startup migrations
- `scripts/generate-build-info.mjs`, `src/server/changelog.ts` — version/changelog
- `convex/auth.config.ts` — Convex JWT provider (the auth bridge)
- `src/lib/storage.ts` — S3/Garage client
