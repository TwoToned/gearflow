# Authentication, Single-Org & Permissions

## Single-Org Architecture

This instance runs in **single-org mode**: exactly one `Organization` row exists, and all users belong to it. The Better Auth Organization plugin is retained for its membership, invitation, and role infrastructure, but multi-org features (org switching, org creation beyond bootstrap, org-specific login routes) are removed.

### Core: `src/lib/single-org.ts`
- `getTheOrg()` — Cached singleton returning the single org's `{ id, name, slug }` (5-minute TTL)
- `invalidateOrgCache()` — Clears cache (called after import, rename, etc.)
- All org resolution flows through this helper; session `activeOrganizationId` is no longer used for org lookup

### Auto-Membership (`src/lib/auth.ts` database hook)
- On user creation, the hook auto-adds the user as a member of the single org
- First user (no existing owner) gets `"owner"` role; subsequent users get `"member"`
- `organizationLimit: 1` in Better Auth config prevents creating additional orgs

### Public Org Actions (`src/server/public-org.ts`)
- `getTheOrgId()` — Returns `{ id }` for the single org (no session required, used by login/register/invite)
- `getSingleOrgSSOInfo()` — Returns SSO config for the single org (used by login page for domain-based SSO detection)

## Better Auth Configuration (`src/lib/auth.ts`)
- Plugins: `organization({ organizationLimit: 1 })`, `twoFactor({ issuer: "GearFlow" })`, `admin()`, `passkey()`, `sso()`, `jwt()`
- Social OAuth login (Google/Microsoft) was removed — only email/password, passkeys, and SSO remain. (Existing `account` rows for legacy google/microsoft links are left untouched.)
- SSO: SAML 2.0 and OIDC via `@better-auth/sso` plugin — org provider configuration
- Account linking: `accountLinking: { enabled: true, trustedProviders: ["sso"] }` — existing users with matching email auto-linked on SSO login
- Email verification, password reset via Resend
- Session stored in PostgreSQL `Session` table
- Passkey RP ID configurable via `PASSKEY_RP_ID` env var (defaults to `localhost`)

## Middleware (`src/middleware.ts`)
- Checks cookies: `better-auth.session_token` or `__Secure-better-auth.session_token` (HTTPS)
- Public routes exempted: `/login`, `/register`, `/api/auth`, `/invite`, `/two-factor`, `/onboarding`, `/api/platform-name`, `/api/registration-policy`, `/pending-approval`
- Unauthenticated requests redirect to `/login?callbackUrl=...`

## Session Helpers (`src/lib/auth-server.ts`)
- `getSession()` — Returns session + user or null
- `requireSession()` — Throws if not authenticated
- `requireOrganization()` — Returns `{ session, organizationId }` using `getTheOrg()` (does NOT read session's `activeOrganizationId`)
- `getActiveOrganizationId()` — Returns the single org's ID via `getTheOrg()`

## Organization Context (`src/lib/org-context.ts`)
- `getOrgContext()` — Returns `{ organizationId, userId, userName }` for the current request
- `orgWhere()` — Returns `{ where: { organizationId } }` for Prisma queries
- `requireRole(roles)` — Validates member has one of the specified roles
- `requirePermission(resource, action)` — Checks permission map, throws 403 if denied

## Single-Org Data Rules
- Every database query MUST include `organizationId` in its WHERE clause (kept for schema consistency)
- Asset tags, project numbers, test tag IDs are unique per org (composite unique indexes)
- File storage is org-prefixed: `{orgId}/{folder}/{entityId}/{filename}`
- All users belong to the single org; `organization.setActive()` is called during login/register for Better Auth compatibility

## Two-Tier Permission Model
1. **Site-level**: `User.role` = `"user"` or `"admin"`. Admin gets access to `/admin` panel
2. **Org-level**: `Member.role` = `owner | admin | manager | member | viewer` (legacy: `staff`, `warehouse`)

## Resource-Action Matrix (`src/lib/permissions.ts`)
16 resources: `asset, bulkAsset, model, kit, project, client, supplier, warehouse, testTag, maintenance, location, document, orgSettings, orgMembers, crew, reports`

Actions per resource: `create, read, update, delete` (varies by resource)

## Role Hierarchy (default permissions)
- **owner/admin**: All permissions on all resources
- **manager**: All CRUD except orgSettings.delete, orgMembers.delete
- **member**: Read + create + update on operational resources, no org settings
- **viewer**: Read-only on all resources
- **Custom roles**: JSON-stored permissions override defaults, managed via `src/server/custom-roles.ts`. Each custom role has an optional `ssoGroupClaim` field for automatic SSO group-to-role matching.

## Client-Side Permission Checking
- `useCurrentRole()` hook from `src/lib/use-permissions.ts` — returns `{ permissions, isLoading }`
- `hasAccess(resource)` in sidebar checks if user has ANY permission for a resource
- `PermissionGate` component conditionally renders children

## Server-Side Enforcement
```typescript
const { organizationId, userId } = await getOrgContext();
await requirePermission("asset", "create"); // throws if denied
```

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
- **Env vars**: `PASSKEY_RP_ID` (e.g. `gearflow.com` in production, `localhost` for dev).

### Social Login (Google & Microsoft) — REMOVED
- Google/Microsoft OAuth social login was removed end-to-end. There is no longer a `socialProviders` block in `auth.ts`, no `/api/auth/social-providers` route, no social buttons on the login page, and no "Connected Accounts" section on the account page.
- The admin "Social Login" toggles and the `SiteSettings.socialLoginGoogle` / `socialLoginMicrosoft` columns were dropped (migration `20260617120500_remove_social_login_settings`).
- Existing Better Auth `account` rows for legacy google/microsoft links are left in place (harmless, no destructive migration). SSO (a separate plugin) is unaffected.

### Invitations
- **Invite-only registration**: Site admin can set registration policy to INVITE_ONLY.
- **Invite signup**: Registration page prefills and locks email when `invite` query param is present.
- **Server actions**: `src/server/invitations.ts` — `getMyPendingInvitations()`, `getInvitationEmail()`, `checkIsSiteAdmin()`.
- All invitations target the single org.

### Account Page Sections
The `/account` page is organized into: Profile (avatar + name), Security (password, 2FA, passkeys, connected accounts), Active Sessions.

## Enterprise SSO

### Overview
Per-org SAML 2.0 and OIDC SSO via `@better-auth/sso` plugin. Managed in `/settings/sso`.

### Key Files
- `src/lib/sso-types.ts` — `OrgSSOSettings` and `SSOGroupMapping` interfaces
- `src/lib/sso-provisioning.ts` — `handleSSOProvisioning` hook (provisionUser)
- `src/server/sso.ts` — SSO server actions (settings, providers, approvals)
- `src/server/public-org.ts` — `getSingleOrgSSOInfo()` for login page SSO detection
- `src/app/(app)/settings/sso/page.tsx` — SSO settings UI
- `src/app/api/auth/sso/org-lookup/route.ts` — Email domain → org lookup

### SSO Settings (stored in `Organization.metadata.sso`)
- `enabled` — Master SSO toggle
- `provisioningMode` — `AUTO_CREATE`, `REQUIRE_APPROVAL`, or `EXISTING_ONLY`
- `defaultRole` — Fallback role when no group mapping matches
- `roleSyncBehavior` — `SYNC_ON_LOGIN`, `INITIAL_ONLY`, or `MANUAL_ONLY`
- `allowPasswordLogin` — Allow email/password alongside SSO
- `enforceSSO` — Require SSO (must pass test login first via `ssoTestedSuccessfully`)
- `groupMappings` — Array of IdP group → GearFlow role mappings
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
- `/login` — Two-step: email first, then checks for SSO match via `getSingleOrgSSOInfo()` (domain-based detection)
- `/pending-approval` — Shown when user authenticated but not yet approved
- No org-specific login route — SSO is triggered automatically from the main login page

### Database Models
- `SSOProvider` (mapped to `sso_provider`) — Created by Better Auth SSO plugin
- `PendingSSOApproval` (mapped to `pending_sso_approval`) — Pending approval records
- `CustomRole.ssoGroupClaim` — Optional field for automatic IdP group matching
