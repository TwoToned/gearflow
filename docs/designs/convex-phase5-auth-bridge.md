# Convex Phase 5 — Auth Bridge (Better Auth → self-hosted Convex JWT)

**Author:** Claude (session 2026-06-10) · **Status:** design + initial implementation
**Parent:** [`convex-hybrid-migration.md`](./convex-hybrid-migration.md) · **Feature doc:** [`FEATUREDOCS/54`](../../FEATUREDOCS/54-convex-data-layer.md)

---

## The problem Phase 5 closes

Through Phases 0–4 every Convex function is **public + unauthed**. Trust is
delegated to the Next.js server actions that call them over HTTP
(`getConvexClient()` → `ConvexHttpClient`, no token). Browser reactive reads
(`useQuery`) are *also* unauthed and "scope" by an `orgId` passed as the first
argument.

`NEXT_PUBLIC_CONVEX_URL` is, by definition, public — the browser connects to the
Convex backend directly. So in the current state **anyone who can reach the
Convex URL can call any function with no credential**:

- **Read any org's data**: `useQuery(api.clients.list, { orgId: "<any org>" })`
  — the `orgId` arg is attacker-controlled, nothing checks it belongs to the
  caller. (Single-org deployments are mitigated only because one org exists.)
- **Write/destroy any data**: `api.assets.remove`, `api.clients.create`,
  `api.projects.update`, … every generated mutation is callable anonymously.

This is the hole Phase 5 must close **before the migration ships to
production**. The fix: give the browser a real identity, require a valid token
on every Convex function, and keep the trusted server-action path working
throughout the hybrid period.

## Non-goals / invariants (do NOT regress these)

- **Convex is never the authZ source of truth.** Fine-grained RBAC
  (`requirePermission`, custom roles) stays in Prisma/Better Auth for the life of
  the migration. Convex enforces only *identity* + *org-scoping* of reads, and
  *"only the trusted server may write."*
- **Auth tables stay in Prisma** (users/sessions/members/customRoles/…). The new
  `jwks` table (key storage for the JWT signer) joins them — it is Better-Auth
  owned, not app data, and gets **no Convex CRUD**.
- **The server-action HTTP path must keep working.** Hardening a function must
  not break the ~55 server/script call sites that funnel through
  `getConvexClient()`.

---

## Trust model

Two token types, **both ES256**, both validated by Convex against the **same**
Better-Auth JWKS (so Convex needs only one provider). They are distinguished by a
claim, not by a separate key:

| | **User token** | **Service token** |
|---|---|---|
| Issued by | Better Auth `jwt()` plugin (`GET /api/auth/token`, session-gated) | `auth.api.signJWT(...)` **in-process**, server-side only |
| `sub` | the user id | `gearflow-service` |
| custom claims | `orgId`, `role` (from the active membership) | `svc: true` |
| `iss` / `aud` | `BETTER_AUTH_URL` / `convex` | same |
| TTL | 15 min | 5 min (cached, auto-refreshed) |
| Reaches the browser? | **yes** (that's the point) | **never** |
| Grants | org-scoped **reads** only | everything (reads any org, all writes) |

Why ES256: Convex `customJwt` providers support **only RS256 / ES256** (not
Better Auth's default EdDSA). The `jwt()` plugin is configured with
`keyPairConfig: { alg: "ES256" }`.

Why one JWKS / two claims (not two keypairs): `signJWT` is a **path-less**
Better-Auth endpoint — it is callable in-process via `auth.api.signJWT()` but is
**not** mounted as an HTTP route, so an attacker cannot mint a `svc: true` token.
The user-facing `/api/auth/token` endpoint only ever returns the
`definePayload` shape (`orgId`/`role`), which never contains `svc`. So the only
way to obtain a service token is to run server code that holds the Better-Auth
secret. This keeps one signer, one JWKS endpoint, one Convex provider, and no
extra long-lived private key to distribute — while preserving a hard
service/user boundary. (Verified at build time: `POST /api/auth/sign-jwt`
returns 404.)

### Who presents which token

```
Browser (useQuery)            ── user token  ──►  Convex  ── org-scoped reads
Server action / script / cron ── service token ─►  Convex  ── reads + writes
  (already ran requirePermission + validation + will logActivity)
```

The **service token is the explicit form of today's implicit "trust the
caller."** Server actions still do all the real authorization (permissions,
validation, audit) *before* calling Convex; the service token is just proof to
Convex that the caller is the trusted backend. Because the service identity is
process-global (not per-user), it is safe to attach to the shared
`ConvexHttpClient` singleton — there is no per-request identity to leak.

Browser **writes are flatly rejected** (mutations require the service token).
That is deliberate: enabling direct browser writes would require porting RBAC
into Convex, which the invariants forbid. Direct browser mutations are a future
phase, gated on a per-mutation authorization design.

---

## Enforcement in Convex (`convex/lib/auth.ts`)

`getAuthContext(ctx)` reads `ctx.auth.getUserIdentity()` and returns:
`{ kind: "service" }` (when `svc === true`), `{ kind: "user", userId, orgId,
role }`, or `null`.

| Helper | Used by | Rule |
|---|---|---|
| `requireService(ctx)` | every **mutation**; non-org `list`/`getById` | identity must be the service token, else throw |
| `requireOrgRead(ctx, orgId)` | org-scoped **`list`** | service ⇒ allow; user ⇒ `user.orgId === orgId`; else throw |
| `requireOrgReadDoc(ctx, doc)` | org-scoped **`getById`** | service ⇒ allow; user ⇒ `doc.organizationId === user.orgId`; null doc ⇒ require identity, return null |

Applied uniformly by the CRUD **generator** (`generate-convex-crud.cjs`), so all
81 modules / 405 functions are hardened in one regen and can't drift:

- **all mutations** (`create`/`update`/`remove`): `requireService`.
- **reads are service-only by default.** `list`/`getById` → `requireService`
  UNLESS the table is org-scoped **and** on the explicit `BROWSER_READABLE`
  allowlist, in which case `list` → `requireOrgRead` and `getById` →
  `requireOrgReadDoc`.

**Why an allowlist, not "has `organizationId`".** The first cut keyed browser-read
on the presence of an `organizationId` column. That was wrong: several org-scoped
tables carry **plaintext secrets** in their columns — warehouse + test-tag-auditor
access tokens, the WooCommerce webhook secret, the Discord signing secret. Since
generated functions are public, "org-scoped ⇒ user-readable" would hand those
secrets to **any** authenticated org member (down to a `viewer`, because single-org
means every member's token org matches) via a direct
`client.query(api.wooCommerceIntegrations.list, { orgId })` — bypassing the Prisma
RBAC that gates them. (Caught by the /cso adversarial pass.) The allowlist is
**exactly** the tables with a reactive `src/hooks/use-*.ts` subscriber; a table
joins it only when its UI goes reactive and its columns hold no secrets. New tables
are service-only until then.

## Server path (`src/lib/convex-client.ts` + `convex-service-token.ts`)

`getConvexClient()` becomes **async**: it lazily mints + caches the service token
(via `auth.api.signJWT`) and `setAuth()`s it on the singleton, refreshing ~30s
before the 5-min expiry. All 55 call sites get an `await`. Because the token is
process-global the singleton stays a singleton. Scripts (`tsx`) and webhooks work
because `signJWT` needs no request/session — just the DB-stored key + secret.

## Browser path (`convex-provider.tsx`)

`ConvexProviderWithAuth` with a `useAuth` hook that:
`fetchAccessToken({ forceRefreshToken })` → `GET /api/auth/token`
(`credentials: "include"`) → `{ token }`; `isAuthenticated` from
`authClient.useSession()`. Convex refreshes the token before expiry. Before a
token exists (logged-out, or first paint) `useQuery` is pending → components
already render their loading state. Inert when `NEXT_PUBLIC_CONVEX_URL` is unset
(unchanged).

---

## Per-function migration recipe (unauthed → authed)

Because hardening is done in the generator, the unit of migration is *the whole
surface at once* for the standard CRUD. The recipe for **promoting a non-org
list/getById to a browser-reactive, org-scoped read** later is:

1. Confirm the table (or its query arg) carries an org anchor.
2. In the generator, move it from the `requireService` branch to a
   `requireOrgRead`-style branch keyed on the right arg, and regenerate.
3. Add the browser hook + ensure the page is behind auth.
4. Re-run the auth round-trip (rejected without token / accepted with).

Custom hand-written queries/mutations (added per-domain in later phases) call the
same `convex/lib/auth.ts` helpers directly.

## Verification

- `pnpm exec tsc --noEmit` clean · `pnpm test` (2185) · 0 new lint · `pnpm build` exit 0.
- **Auth round-trip** (`scripts/convex-auth-roundtrip.ts`): an anonymous
  `ConvexHttpClient` call to a hardened function is **rejected**; the same call
  with a service token **succeeds**; a user-token call to a *mutation* is
  **rejected**, to an org-scoped *read* with a matching org **succeeds** and with
  a mismatched org is **rejected**.
- `POST`/`GET /api/auth/sign-jwt` → 404 (service-mint endpoint is not HTTP-exposed);
  `GET /api/auth/token` without a session → 401 (user tokens are session-gated).
- `/cso` security review of the diff — hard gate before landing.

**Verified 2026-06-10:** all 8 round-trip checks pass (anon read REJECTED, service
read ALLOWED, user-match read ALLOWED, user-wrong-org read REJECTED, user mutation
REJECTED, anon mutation REJECTED, user read of a secret table REJECTED, service read
of it ALLOWED); sign-jwt 404; `/token` 401 without a session; tsc/2185 tests/0-new-
lint/build all green; `/cso` adversarial pass clean (it caught the
secret-table-exposure finding, now fixed by the `BROWSER_READABLE` allowlist).

> **Local-dev JWKS reachability gotcha.** Convex (Docker) must fetch the JWKS from
> the Next app. The self-hosted backend runs on its own compose network
> (`gearflow-convex_default`, gateway `172.21.0.1`), but `host.docker.internal`
> resolves to the *default* docker0 bridge (`172.17.0.1`) and many Linux hosts'
> firewalls drop container→host on arbitrary ports — so `host.docker.internal:3000`
> can fail to fetch even though the app is up. Fixes, in order of preference:
> point `CONVEX_AUTH_JWKS_URL` at a URL the backend's network can actually reach,
> open the host firewall for that port, or (for a one-off verification) serve the
> JWKS from a sidecar container on the Convex network. In production the app's JWKS
> URL is normally directly reachable, so this is a local-only wrinkle.

## Known residual (sub-8, tracked)

`crewMembers` is browser-readable (the crew dashboard subscribes to it) and its
row carries `icalToken` — a per-member calendar-feed token. So an org member's
user-token read of `api.crewMembers.list` returns coworkers' `icalToken`s, letting
a member subscribe to a coworker's crew-schedule feed. This is **internal-only**
(authenticated org members, not the public — and pre-existing: the reactive crew
table already streamed the whole `crewMember` doc to the browser; Phase 5 actually
narrowed it from "anyone with the URL" to "org members"). It is a low-value feed
token, not a system credential, so it sits below the `/cso` 8/10 gate. The proper
fix is **field-level redaction** for browser reads (strip sensitive columns from
user-token responses, or drop `icalToken` from the Convex mirror entirely since the
iCal route reads it from Prisma) — a generator capability worth building once for
all such fields during Phase 6, not a one-off here. Tracked.

## Env vars added

| Var | Where | Purpose |
|---|---|---|
| `CONVEX_AUTH_ISSUER` | Convex deploy env | `iss` the provider trusts (default `BETTER_AUTH_URL`) |
| `CONVEX_AUTH_JWKS_URL` | Convex deploy env | JWKS URL Convex fetches (container-reachable; local `http://host.docker.internal:3000/api/auth/jwks`) |

The JWT signer's keypair lives in the DB (`jwks` table), encrypted with
`BETTER_AUTH_SECRET` — no new app secret to manage.
