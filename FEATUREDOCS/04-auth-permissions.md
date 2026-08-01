# Authentication, Multi-Tenancy & Permissions

> _Owner: Jayden Nawotka · Last reviewed: 2026-08-01 (review quarterly — POLICY.md R-5.5)_

## Multi-Tenant Architecture (#1064, Phase A)

The app is multi-tenant: any number of `Organization` rows can exist, and a user's
memberships determine which org(s) they belong to. Single-org mode (exactly one
`Organization` row, every user auto-joined) was removed in Phase A (#1071, A1) —
`src/lib/single-org.ts` and its `getTheOrg()` cached singleton no longer exist.

**Self-serve org creation is still gated off** (D7): `allowUserToCreateOrganization`
in `src/lib/auth.ts` only permits creating an org while zero orgs exist system-wide
(the one-time bootstrap, `src/app/(auth)/onboarding/page.tsx`). Phase B (#1067)
replaces this interim gate with the real site-admin `allowOrgCreation` toggle +
signup code (D6). Until then, additional orgs are created by a site admin
(`adminCreateOrganization`, `src/server/site-admin.ts`).

### Org resolution: the session, re-validated (`src/lib/auth-server.ts`)
- `requireOrganization()` / `getActiveOrganizationId()` resolve the **active org from
  the session** (`session.session.activeOrganizationId`, set by the client-callable
  `organization.setActive()`), but **never trust it alone** (R-9.3) — every
  resolution re-validates it against a live `Member` row. A removed member, an
  archived membership, or a stale/forged session value resolves to `null`, not the
  claimed org.
- Memoized per-request with React `cache()` so every caller in the same request
  shares one session fetch + one membership query.
- The Convex JWT's `orgId`/`role` claims (`src/lib/auth.ts`'s `definePayload`) are
  minted the same way — re-read from a live `Member` row at every mint, with a
  same-request fallback to the user's SOLE membership if `activeOrganizationId` is
  unset (e.g. the SSO-redirect race `OrgActivator` exists to heal). With 0 or 2+
  memberships and no active org set, nothing is guessed — `orgId: null`.

### Membership creation — invite/provisioning only, never auto-join
Membership is only ever created by: invite-accept (`organization.acceptInvitation`),
SSO auto-provisioning (`handleSSOProvisioning`, AUTO_CREATE mode), org-create
(`creatorRole: "owner"`), or a site admin (`adminCreateOrganization`,
`adminAddMemberToOrg`). The `user.create` database hook's old single-org auto-join
(every new signup silently joined "the org") was deleted (#1071, A1) — a fresh
signup with no invite and no org to bootstrap lands with **zero** memberships and is
routed to `/onboarding`. **Known gap:** with `registrationPolicy: OPEN` and no
pending invite, that onboarding visit dead-ends once an org already exists (org
creation is gated off, D7) — the "request to join" flow that resolves this
(`DOMAIN_REQUEST` join policy, design doc §4.3) hasn't landed yet.

### Which org(s) does this user belong to? (`src/server/public-org.ts`)
- `getMyOrganizations()` — the calling session's memberships (`{ id, name, slug,
  role }[]`), membership-derived, never a list of all orgs filtered client-side
  (R-9.3). The multi-tenant replacement for the single-org `getTheOrgId()` —
  login/register/invite/onboarding/`OrgActivator`/the `(app)` layout gate all
  resolve through here: **0 → `/onboarding`, 1 → activate it, 2+ → `/select-organization`
  (never guess which one).**
- `getSoloOrgBranding()` — best-effort org name for the pre-auth login page, returned
  only when exactly one org exists system-wide (an anonymous visitor's org isn't
  otherwise knowable pre-auth).
- `mirrorMyMembership(organizationId)` — mirrors the calling session's own
  membership into Convex; still required after `organization.create()` (see its
  docstring — without it the bootstrap owner has a Postgres membership and no
  Convex one, and every Convex-authorized action fails).

### The org switcher and picker (#1072, A2 — D14)
- `src/app/(auth)/select-organization/page.tsx` — the "never guess" picker: shown to
  a 2+-membership user post-login/post-SSO/via `OrgActivator`, lets them choose,
  then calls `organization.setActive()` and navigates to a tenant-neutral
  `callbackUrl` (never a stale id from the previous context).
- `OrgActivator` (`src/components/providers/org-activator.tsx`) heals a
  missing active org on the client (mainly the SSO-redirect gap): 1 membership →
  activate it; 2+ → route to the picker; 0 → nothing to activate (the `(app)`
  layout's own guard handles 0 memberships).
- **The switcher dropdown** (`UserNav`, `src/components/layout/user-nav.tsx`) adds an
  "Organisations" group to the existing sidebar-footer menu — one item per
  `getMyOrganizations()` membership (never a client-filtered list of all orgs), a
  check against the active org, role as secondary text. Shown only with ≥2
  memberships; the active org's name fills the trigger's second line regardless
  (replacing what used to be a duplicate of the email shown two rows below).
  Picking an org calls `organization.setActive()` then `router.push("/dashboard")` —
  same tenant-neutral-root rule as the picker.

#### The sharp edge: re-minting the Convex token on switch

`organization.setActive()` updates the Better Auth session, but the Convex JWT bakes
`orgId` in as a claim (`definePayload`, `src/lib/auth.ts`) — and Convex's
`ConvexProviderWithAuth` only refetches that token on its own schedule (mount +
pre-expiry), never merely because a render happened. Left alone, every live
subscription would keep serving the **previous** org's data until the token
happened to expire — a cross-tenant read produced by the switcher itself.

Fixed centrally in `src/components/providers/convex-provider.tsx`, not in the
switcher: `useBetterAuthForConvex`'s `fetchAccessToken` callback includes the
active org id in its dependency array. Convex's own `ConvexAuthStateFirstEffect`
calls `client.setAuth(fetchAccessToken, ...)` inside a `useEffect` keyed on that
callback's identity — and `client.setAuth` (`AuthenticationManager.setConfig`,
verified against the installed `convex` package source, not assumed from docs)
unconditionally pauses the socket, force-fetches a fresh token, and
re-authenticates. So switching org changes `orgId` → `fetchAccessToken` gets a new
identity → the effect reruns → the client force-reauthenticates and every
subscription re-evaluates under the new claim. No caller (switcher, picker,
`OrgActivator`) has to orchestrate this itself — there's exactly one place a
Convex identity is minted, and the reactivity lives there.

`useServerQuery` reads (server-action-backed, not Convex subscriptions) invalidate
correctly only when their `queryKey` includes `orgId` — `UserNav`'s own
`my-crew-id`/`my-organizations` keys follow this. **Known gap**: no exhaustive
sweep of every `useServerQuery` call site for a missing `orgId` key has been done
yet — deferred to A6 (`#1076`), the registry-driven cross-tenant audit, rather than
hand-checked here.

**Known gap, E2E coverage**: the design called for an explicit E2E (a user in two
orgs switches, asserts the second org's dashboard shows none of the first org's
entities), but writing one hits the same root cause already blocking
`harness-onboarding`/`harness-revenue-path`/`harness-sign-out` (`#1118`): the
shared-DB harness can't create a second org once one exists in a run, and this
scenario additionally needs invitation-acceptance across two accounts, which has
no test-harness affordance for reading a sent invite without email delivery.
Covered instead by a jsdom smoke test that actually opens the menu
(`src/components/layout/__tests__/user-nav.test.tsx`) — proves the group's
membership-count gating, the per-item render, and that a click fires
`setActive()` + `push("/dashboard")`, but not live cross-tenant data isolation.
Tracked under the same `#1118` as the other quarantined harness gaps.

### Org archiving (#1075, A5 — D12) — archived, never deleted, reversible
- `Organization.archivedAt DateTime?` (Postgres — `apiKillSwitchAt`'s sibling column).
  Deliberately **not** mirrored to Convex: unlike `apiKillSwitchAt` (moved to the
  Convex `orgSettings` row in the Phase 1 inversion), nothing Convex-side needs to
  check it directly — see the next bullet.
- **Enforced at the identity chokepoints, not per-query.** Three guards, all with an
  `organization: { archivedAt: null }` filter on their existing membership query (no
  extra round trip): `resolveActiveOrganizationId` (`src/lib/auth-server.ts`),
  `definePayload` (`src/lib/auth.ts`, the Convex JWT mint — this is the one every
  Convex read/write ultimately trusts, so an archived org's `orgId` is never minted
  into a claim at all), and `getApiKeyActorContext` (`src/lib/api-key.ts`, the agent/
  API-key path, mirroring the `ORG_KILL_SWITCH` check next to it with a new
  `ORG_ARCHIVED` `ApiKeyRejectionCode`). Better Auth's own `organization.setActive()`
  has no archival concept (only checks membership) and can't be hooked, so archiving
  can't be enforced there — it's enforced downstream instead, same as a removed
  member.
- **Non-chokepoint paths need their own explicit check** — anything resolving org
  identity from a bare id, a public token, or an unauthenticated fallback doesn't go
  through the chokepoints above: the WooCommerce webhook (`src/app/api/integrations/
  woocommerce/webhook/route.ts`), the iCal feed (`src/app/api/calendar/[token]/
  [feed]/route.ts`), and the outbound-email cron sweeps (`notification-email-
  sender.ts`, `test-tag-reminders.ts`'s digest send) all filter `archivedAt: null`
  explicitly. **Known gap:** background Xero push jobs weren't audited for the same
  gap — spot-check before relying on this list being exhaustive.
- `src/server/site-admin.ts`'s `adminArchiveOrganization`/`adminUnarchiveOrganization`
  replace the old `adminDeleteOrganization`, which was a bare `prisma.organization.
  delete()` — Postgres FKs cascade, but every model/asset/project/quote lives in
  Convex now (no cascade), so a hard delete orphaned the entire domain dataset while
  the orphaned docs kept their `organizationId` and stayed reachable by any
  global-index read that skipped its org check. Archive releases the org's `slug`
  (rewrites it to `<slug>-archived-<id>`, since `slug` is `@unique`) so a new org can
  claim it immediately; **unarchive does NOT auto-restore the original slug** (it
  could be taken by then) — an admin renames it back manually if wanted.
- `getMyOrganizations()` (`src/server/public-org.ts`) filters archived orgs out, so
  they never appear in the picker/switcher/`OrgActivator`.
  `hasOnlyArchivedMemberships()` distinguishes "every org I'm in got archived" from
  "never had one" for the `(app)` layout gate, which routes the former to
  `/organization-archived` (an explanatory screen) instead of `/onboarding`.

## Better Auth Configuration (`src/lib/auth.ts`)
- Plugins: `organization({...})` (no `organizationLimit` cap — creation is gated by
  `allowUserToCreateOrganization`, not a per-user limit), `twoFactor({ issuer: "RVLT Flow" })`, `admin()`, `passkey()`, `sso()`, `jwt()`
- Social OAuth login (Google/Microsoft) was removed — only email/password, passkeys, and SSO remain. (Existing `account` rows for legacy google/microsoft links are left untouched.)
- SSO: SAML 2.0 and OIDC via `@better-auth/sso` plugin — org provider configuration
- Account linking: `accountLinking: { enabled: true, trustedProviders: ["sso"] }` — existing users with matching email auto-linked on SSO login
- Email verification, password reset via Resend
- Session stored in PostgreSQL `Session` table
- Passkey RP ID configurable via `PASSKEY_RP_ID` env var (defaults to `localhost`)

## Auth Client Base URL & CORS (`src/lib/auth-client.ts`)
The browser auth client resolves its `baseURL` from `window.location.origin` — **never** from `NEXT_PUBLIC_APP_URL`. The `/api/auth` handler is co-located with the app, so auth calls are always same-origin; there is no CORS preflight and no `Access-Control-Allow-Origin` requirement.

**Why not `NEXT_PUBLIC_APP_URL`?** `NEXT_PUBLIC_*` vars are *inlined into the client bundle at `next build`* (baked via the Dockerfile `ARG` + the `vars.NEXT_PUBLIC_APP_URL` GitHub Actions variable in `build-image.yml`). A baked URL keeps pointing at the *old* domain after a move, even after you update Coolify's runtime env — the compiled JS can't change. That caused a `get-session` CORS failure when the app moved to `flow.rvlt.app` while the bundle still called `gearflow.prod.rvlt.app`. Using `window.location.origin` means **moving domains never requires a rebuild**; only SSR (no `window`) falls back to `NEXT_PUBLIC_APP_URL`.

Server-side origin allow-listing still uses env (`trustedOrigins` in `src/lib/auth.ts` reads `env.NEXT_PUBLIC_APP_URL` + `env.SSO_TRUSTED_ORIGINS`), and these are read at *runtime*, so a Coolify env change is enough for the server. After any domain move, set runtime `BETTER_AUTH_URL` + `NEXT_PUBLIC_APP_URL` (Coolify) and `CONVEX_AUTH_ISSUER` + `CONVEX_AUTH_JWKS_URL` (Convex deployment) to the new origin.

## Middleware (`src/middleware.ts`)
- Checks cookies: `better-auth.session_token` or `__Secure-better-auth.session_token` (HTTPS)
- Public routes exempted: `/login`, `/register`, `/api/auth`, `/invite`, `/two-factor`, `/onboarding`, `/api/platform-name`, `/api/registration-policy`, `/pending-approval`
- Unauthenticated requests redirect to `/login?callbackUrl=...`

## Session Cookie Hardening (POLICY.md R-8.4.5)
- `src/lib/cookie-security.ts` — `shouldUseSecureCookies(appUrl)` gates Better Auth's `advanced.useSecureCookies` on the app's serve protocol (`NEXT_PUBLIC_APP_URL`), so local http dev doesn't drop cookies while prod (https) stays hardened. Unit-tested in `src/lib/__tests__/cookie-security.test.ts`.
- `e2e/harness-cookie-flags.spec.ts` — integration test asserting the Better Auth session cookie carries `HttpOnly` + `SameSite` after a real login (runs against the seeded harness, `E2E_HARNESS=1`).

## Session Helpers (`src/lib/auth-server.ts`)
- `getSession()` — Returns session + user or null
- `requireSession()` — Throws if not authenticated
- `requireOrganization()` — Returns `{ session, organizationId }`, resolving the active org from `session.session.activeOrganizationId` and re-validating it against a live `Member` row (never trusted alone, R-9.3)
- `getActiveOrganizationId()` — Same resolution, org id only. Both share one memoized (`cache()`) per-request lookup.

## Organization Context (`src/lib/org-context.ts`)
- `getOrgContext()` — Returns `{ organizationId, userId, userName }` for the current request
- `orgWhere()` — Returns `{ where: { organizationId } }` for Prisma queries
- `requireRole(roles)` — Validates member has one of the specified roles
- `requirePermission(resource, action)` — Checks permission map, throws 403 if denied

## Multi-Tenant Data Rules
- Every database query MUST include `organizationId` in its WHERE clause — the real tenancy boundary now that more than one org can exist (R-8.4.3)
- Asset tags, project numbers, test tag IDs are unique per org (composite unique indexes)
- File storage is org-prefixed: `{orgId}/{folder}/{entityId}/{filename}`
- A user's active org comes from their session, re-validated against a live membership on every resolution; `organization.setActive()` is called during login/register/invite-accept/org-create, and by the picker/`OrgActivator` when a session arrives with no (or an invalid) active org set

## Two-Tier Permission Model
1. **Site-level**: `User.role` = `"user"` or `"admin"`. Admin gets access to `/admin` panel
2. **Org-level**: `Member.role` = `owner | admin | manager | member | viewer` (legacy: `staff`, `warehouse`)

### Site-Admin Guard — single source of truth (`src/lib/admin-auth.ts`, POLICY.md R-8.4.2/R-8.4.4)
All site-admin checks (`User.role === "admin"`) go through exactly one module — no call site re-queries `role` directly:
- `requireSiteAdmin()` — throws if not a site admin, returns the session. Used by server actions in `src/server/site-admin.ts`.
- `requireSiteAdminApi()` — for API routes; returns `{ userId }`.
- `isSiteAdmin()` — boolean check, never throws. `src/server/site-admin.ts` and `src/server/invitations.ts` (`checkIsSiteAdmin()`) both delegate to this; `src/app/(admin)/layout.tsx` uses it directly to redirect non-admins.

## Resource-Action Matrix (`src/lib/permissions.ts`)
16 resources: `asset, bulkAsset, model, kit, project, client, supplier, warehouse, testTag, maintenance, location, document, orgSettings, orgMembers, crew, reports`

Actions per resource: `create, read, update, delete` (varies by resource)

## Role Hierarchy (default permissions)
- **owner/admin**: All permissions on all resources
- **manager**: All CRUD except orgSettings.delete, orgMembers.delete
- **member**: Read + create + update on operational resources, no org settings
- **viewer**: Read-only on all resources
- **Custom roles**: removed — `CustomRole`/`customRoles` and `src/server/custom-roles.ts` no longer exist anywhere in the codebase (Prisma or Convex). Only the fixed owner/admin/manager/member/viewer roles above exist today.

## Client-Side Permission Checking
- `useCurrentRole()` hook from `src/lib/use-permissions.ts` — returns `{ permissions, isLoading }`
- `hasAccess(resource)` in sidebar checks if user has ANY permission for a resource
- `PermissionGate` component conditionally renders children
- **`RequirePermission` (`src/components/auth/require-permission.tsx`) reads `useCurrentRole()` directly, not `useCanDo`.** `useCanDo` returns `false` while its permissions query is still loading (a deliberate safe default for gating individual write buttons — see `useIsViewer`'s doc comment). A page-level gate built on it would flash "Access Denied" for every authorized user on every gated route before flipping to the real content once the query resolves — a false negative, and a spurious late LCP/CLS candidate on data-heavy dashboards (fixed 2026-07-25, R-8.9.3 finding #862). `RequirePermission` renders nothing while `isLoading` (or `permissions` is still null), the denial only once the check has actually run.

## Server-Side Enforcement
```typescript
const { organizationId, userId } = await getOrgContext();
await requirePermission("asset", "create"); // throws if denied
```

## Agent (API/MCP) auth kind

A third identity kind sits alongside `service`/`user`: `agent` — a short-lived JWT
minted per API/MCP request from an org's `apiKeys` row (`convex/lib/auth.ts`'s
`getAuthContext`). It behaves **exactly like `user` everywhere** (same member-row
RBAC, same `resolveActor` subject pinning, same kill switch) plus a scope
intersection (`requireAgentScope` — the key's granted scopes ∩ the acting user's live
role) and its own rate-limit bucket. `requireService()` still rejects it, which is
what makes the ~600 SERVICE-only functions structurally unreachable from the API. Full
design, the token-minting invariants, and the scope vocabulary: **FEATUREDOCS/56**
(Agent-Accessible API + MCP). Mira, the in-app assistant, is the first first-party
consumer of this same identity kind — **FEATUREDOCS/68**.

## User Customisation & Auth Methods

### Profile Pictures
- **UserAvatar component** (`src/components/ui/user-avatar.tsx`): Reusable avatar with image + initials fallback. Sizes: `xs` (24px), `sm` (32px), `md` (40px), `lg` (48px), `xl` (64px).
- **Upload**: `POST /api/avatar` — resizes to 256x256 via `sharp`, stores under global `avatars/users/{userId}/` S3 prefix.
- **Remove**: `DELETE /api/avatar` — deletes S3 file, sets `User.image` to null.
- **File proxy**: `GET /api/files/avatars/...` allowed without org prefix validation (avatars are global).

### Passkeys (WebAuthn)
- **Plugin**: `@better-auth/passkey` — server config in `src/lib/auth.ts`, client in `src/lib/auth-client.ts`.
- **Login page**: "Sign in with Passkey" button using `authClient.signIn.passkey()`. Email input has `autocomplete="username webauthn"`.
- **Account page**: Passkey management — list, add (`authClient.passkey.addPasskey()`), rename, delete.
- **Env vars**: `PASSKEY_RP_ID` (e.g. `rvlt.app` in production, `localhost` for dev).

### Social Login (Google & Microsoft) — REMOVED
- Google/Microsoft OAuth social login was removed end-to-end. There is no longer a `socialProviders` block in `auth.ts`, no `/api/auth/social-providers` route, no social buttons on the login page, and no "Connected Accounts" section on the account page.
- The admin "Social Login" toggles and the `SiteSettings.socialLoginGoogle` / `socialLoginMicrosoft` columns were dropped (migration `20260617120500_remove_social_login_settings`).
- Existing Better Auth `account` rows for legacy google/microsoft links are left in place (harmless, no destructive migration). SSO (a separate plugin) is unaffected.

### Invitations
- **Invite-only registration**: Site admin can set registration policy to INVITE_ONLY.
- **Invite signup**: Registration page prefills and locks email when `invite` query param is present.
- **Server actions**: `src/server/invitations.ts` — `getMyPendingInvitations()`, `getInvitationEmail()`, `checkIsSiteAdmin()`, `getInvitationOrganizationId()`.
- Each invitation targets a specific org (`Invitation.organizationId`) — the invite-accept page resolves which org to activate from the invitation row itself via `getInvitationOrganizationId()`, not a single-org assumption.
- **Membership always requires the recipient's consent (#1073, A3).** `addMemberByEmail` (`src/server/settings.ts`, the "Invite" control on `/settings/team`) creates an `Invitation` and emails an accept link (`/invite/[id]`) for EVERY case — including an email that already has an account. There is no direct-add path: under multi-tenancy, silently creating a `Member` row for a known email would let any org owner pull a stranger's account into their org with no consent, putting an unwanted org in that person's switcher. `/invite/[id]` itself branches on whether the recipient is already signed in (accept immediately) or needs to sign in/register first — the invite email is the same either way (`invitationEmail`, not a register-specific template).
- **Known gap, not built yet**: a per-org join policy (`INVITE_ONLY` | `DOMAIN_REQUEST` | `CLOSED`, distinct from the platform-global `registrationPolicy` above) is designed (`docs/designs/onboarding-and-activation.md` §2.4/§4.3) but has no consumer until Phase B's (#1067) create-vs-join signup fork exists — there's currently no self-serve "request to join an org" flow for it to gate, so it wasn't added as an inert setting. Revisit alongside #1067.

### Account Page Sections
The `/account` page is organized into: Profile (avatar + name), Security (password, 2FA, passkeys, connected accounts), Active Sessions.

## Enterprise SSO

### Overview
Per-org SAML 2.0 and OIDC SSO via `@better-auth/sso` plugin. Managed in `/settings/sso`.

### Key Files
- `src/lib/sso-types.ts` — `OrgSSOSettings` and `SSOGroupMapping` interfaces
- `src/lib/sso-provisioning.ts` — `handleSSOProvisioning` hook (provisionUser)
- `src/server/sso.ts` — SSO server actions (settings, providers, approvals)
- `src/app/api/auth/sso/org-lookup/route.ts` — email-domain → org(s) lookup for login page SSO detection (IP rate-limited)
- `src/app/(app)/settings/sso/page.tsx` — SSO settings UI

### SSO Settings (stored in `Organization.metadata.sso`)
- `enabled` — Master SSO toggle
- `provisioningMode` — `AUTO_CREATE`, `REQUIRE_APPROVAL`, or `EXISTING_ONLY`
- `defaultRole` — Fallback role when no group mapping matches
- `roleSyncBehavior` — `SYNC_ON_LOGIN`, `INITIAL_ONLY`, or `MANUAL_ONLY`
- `allowPasswordLogin` — Allow email/password alongside SSO
- `enforceSSO` — Require SSO (must pass test login first via `ssoTestedSuccessfully`)
- `groupMappings` — Array of IdP group → RVLT Flow role mappings
- `oidcGroupsClaim` / `samlGroupsAttribute` — Claim names for group extraction

### Provisioning Modes
1. **AUTO_CREATE**: User is created as org member immediately on first SSO login
2. **REQUIRE_APPROVAL**: Creates `PendingSSOApproval` record; admin must approve in `/settings/sso`
3. **EXISTING_ONLY**: Only existing org members can sign in via SSO

### Group-to-Role Matching (priority order)
1. Custom roles with `ssoGroupClaim` matching an IdP group
2. Explicit group mappings in SSO settings
3. Default role fallback

### Login Flow
- `/login` — Two-step: email first, then checks for an SSO match via `POST /api/auth/sso/org-lookup` (domain-based, multi-org-aware detection; ambiguous across 2+ orgs falls through to password)
- `/pending-approval` — Shown when user authenticated but not yet approved
- No org-specific login route — SSO is triggered automatically from the main login page

### Database Models
- `SSOProvider` (mapped to `sso_provider`) — Created by Better Auth SSO plugin
- `PendingSSOApproval` (mapped to `pending_sso_approval`) — Pending approval records
- `CustomRole.ssoGroupClaim` — Optional field for automatic IdP group matching
