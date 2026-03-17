# Authentication, Multi-Tenancy & Permissions

## Better Auth Configuration (`src/lib/auth.ts`)
- Plugins: `organization()`, `twoFactor({ issuer: "GearFlow" })`, `admin()`, `passkey()`, `sso()`
- Social providers: Google and Microsoft (conditional on env vars `GOOGLE_CLIENT_ID`, `MICROSOFT_CLIENT_ID`)
- SSO: SAML 2.0 and OIDC via `@better-auth/sso` plugin — per-org provider configuration
- Account linking: `accountLinking: { enabled: true, trustedProviders: ["sso"] }` — existing users with matching email auto-linked on SSO login
- Email verification, password reset via Resend
- Session stored in PostgreSQL `Session` table with `activeOrganizationId`
- Passkey RP ID configurable via `PASSKEY_RP_ID` env var (defaults to `localhost`)

## Middleware (`src/middleware.ts`)
- Checks cookies: `better-auth.session_token` or `__Secure-better-auth.session_token` (HTTPS)
- Public routes exempted: `/login`, `/register`, `/api/auth`, `/invite`, `/two-factor`, `/no-organization`, `/onboarding`, `/api/platform-name`, `/api/registration-policy`, `/pending-approval`
- Unauthenticated requests redirect to `/login?callbackUrl=...`

## Session Helpers (`src/lib/auth-server.ts`)
- `getSession()` — Returns session + user or null
- `requireSession()` — Throws if not authenticated
- `requireOrganization()` — Throws if no `activeOrganizationId`

## Organization Context (`src/lib/org-context.ts`)
- `getOrgContext()` — Returns `{ organizationId, userId, userName }` for the current request
- `orgWhere()` — Returns `{ where: { organizationId } }` for Prisma queries
- `requireRole(roles)` — Validates member has one of the specified roles
- `requirePermission(resource, action)` — Checks permission map, throws 403 if denied

## Multi-Tenancy Rules
- Every database query MUST include `organizationId` in its WHERE clause
- Asset tags, project numbers, test tag IDs are unique per org (composite unique indexes)
- File storage is org-prefixed: `{orgId}/{folder}/{entityId}/{filename}`
- Users can belong to multiple orgs; `activeOrganizationId` on the session determines the current context

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

### Social Login (Google & Microsoft)
- Conditional on env vars — providers only enabled when `GOOGLE_CLIENT_ID` / `MICROSOFT_CLIENT_ID` are set.
- Login page shows social buttons dynamically via `/api/auth/social-providers`.
- Account page "Connected Accounts" section with Connect buttons via `authClient.linkSocial()`.
- Better Auth auto-links social accounts to existing users with matching email.

### Invitations & No-Org Flow
- **Invite-only registration**: Site admin can set registration policy to INVITE_ONLY.
- **No-org page**: `src/app/(auth)/no-organization/page.tsx` — shown when user has no org memberships.
- **Invite signup**: Registration page prefills and locks email when `invite` query param is present.
- **Server actions**: `src/server/invitations.ts` — `getMyPendingInvitations()`, `getInvitationEmail()`, `checkIsSiteAdmin()`.

### Account Page Sections
The `/account` page is organized into: Profile (avatar + name), Security (password, 2FA, passkeys, connected accounts), Organizations, Active Sessions.

## Enterprise SSO

### Overview
Per-org SAML 2.0 and OIDC SSO via `@better-auth/sso` plugin. Managed in `/settings/sso`.

### Key Files
- `src/lib/sso-types.ts` — `OrgSSOSettings` and `SSOGroupMapping` interfaces
- `src/lib/sso-provisioning.ts` — `handleSSOProvisioning` hook (provisionUser)
- `src/server/sso.ts` — SSO server actions (settings, providers, approvals)
- `src/app/(app)/settings/sso/page.tsx` — SSO settings UI
- `src/app/(auth)/login/[orgSlug]/` — Org-specific login page
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
- `/login` — Two-step: email first, then checks for SSO org match via `/api/auth/sso/org-lookup`
- `/login/[orgSlug]` — Org-specific page with prominent SSO button, optional social/password
- `/pending-approval` — Shown when user authenticated but not yet approved

### Database Models
- `SSOProvider` (mapped to `sso_provider`) — Created by Better Auth SSO plugin
- `PendingSSOApproval` (mapped to `pending_sso_approval`) — Pending approval records
- `CustomRole.ssoGroupClaim` — Optional field for automatic IdP group matching
