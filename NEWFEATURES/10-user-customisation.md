# Feature: User Profile Customisation & Additional Auth Methods

> **Partial status check (this cleanup pass):** Section 1 (Profile Pictures —
> `UserAvatar` component exists at `src/components/ui/user-avatar.tsx`) and
> Section 2 (Passkeys — `@better-auth/passkey` is wired server+client in
> `src/lib/auth.ts`/`auth-client.ts`, with UI on `/account` and `/login`) are
> **already shipped**. Section 3 (Social Login Providers) is **not** shipped —
> and re-adding it would directly reverse the deliberate `chore/remove-social-login`
> decommission from the June 2026 feature-removal sweep
> (`docs/designs/archive/feature-removal-2026-06.md`). Whether to build social
> login is a product call, not something this docs-cleanup pass should decide —
> flagging it here rather than silently deleting or rewriting the spec.

## Summary

Enhance user profiles with photo uploads and expand authentication options to include passkeys (WebAuthn), social login providers (Google, GitHub, Apple, Microsoft), and improved account management UI. This brings RVLT Flow's user experience up to modern platform standards and gives users flexible, secure ways to authenticate.

---

## Table of Contents

1. [Profile Pictures](#1-profile-pictures)
2. [Passkeys (WebAuthn)](#2-passkeys-webauthn)
3. [Social Login Providers](#3-social-login-providers)
4. [Account Page Enhancements](#4-account-page-enhancements)
5. [Data Model Changes](#5-data-model-changes)
6. [Server Actions](#6-server-actions)
7. [Auth Configuration Changes](#7-auth-configuration-changes)
8. [Security Considerations](#8-security-considerations)
9. [Mobile & PWA](#9-mobile--pwa)
10. [Implementation Phases](#10-implementation-phases)

---

## 1. Profile Pictures

### Current State

The `User` model has an `image` field (string, nullable) but it's not actively used — there's no upload mechanism and no UI for displaying avatars beyond a fallback initials circle.

### Upload Flow

1. User navigates to `/account` (or clicks their avatar in the sidebar/top bar)
2. Clicks their avatar/initials circle → opens a file picker or the `MediaUploader` component
3. Selects an image (JPEG, PNG, WebP, max 5MB)
4. Image is uploaded to S3 via `POST /api/uploads` under the path `{orgId}/avatars/{userId}/{uuid}-{filename}`
5. Server resizes/crops to a square (256×256) — use `sharp` for server-side processing
6. `User.image` is updated with the URL
7. Avatar is immediately visible everywhere in the app

### Where Avatars Display

Update all places that show user identity to display the avatar:
- **Sidebar**: User nav button at the bottom (currently shows initials)
- **Top bar**: User avatar in the top-right area
- **Org member list**: `/settings/team` — each member row shows their avatar
- **Project detail**: Project manager display
- **Crew assignments**: Crew member avatars on project crew tab
- **Activity log**: User avatar next to each log entry
- **Comments/notes**: If any attribution UI exists
- **Notifications**: Avatar of the person who triggered the notification

### Avatar Component

Create a reusable `UserAvatar` component (`src/components/ui/user-avatar.tsx`):

```typescript
interface UserAvatarProps {
  user: { name?: string | null; image?: string | null };
  size?: "xs" | "sm" | "md" | "lg" | "xl";  // 24, 32, 40, 48, 64px
  className?: string;
}
```

- If `image` is set: render an `<img>` with rounded-full and the S3 URL (via the file proxy `/api/files/...`)
- If no image: render an initials circle with the user's first initial(s), coloured based on a hash of the user's name (consistent colour per user)
- Support `CrewMember.image` too — same component, different data source

### Removal

Users can remove their profile picture from the account page. This sets `User.image` to null and deletes the S3 file.

### Org-Scoped Storage

Profile pictures are stored under the active org's S3 prefix. If a user is in multiple orgs, they have one profile picture per org context (since file storage is org-scoped). Alternatively, store avatars under a global `avatars/` prefix not scoped to any org — this is simpler since a user's face doesn't change between orgs. The file proxy would need a special case for avatar paths.

**Recommendation**: Store under a global `avatars/{userId}/` prefix. Update the file proxy to allow access to avatar paths without org prefix validation (avatars are not sensitive data — they're just profile photos).

---

## 2. Passkeys (WebAuthn)

### Plugin Setup

Better Auth provides passkeys via `@better-auth/passkey`, powered by SimpleWebAuthn.

**Install:**
```bash
npm install @better-auth/passkey
```

**Server config (`src/lib/auth.ts`):**
```typescript
import { passkey } from "@better-auth/passkey";

export const auth = betterAuth({
  plugins: [
    // ... existing plugins ...
    passkey({
      rpID: process.env.PASSKEY_RP_ID || "localhost",     // e.g. "rvlt.app"
      rpName: "RVLT Flow",
      origin: process.env.BETTER_AUTH_URL || "http://localhost:3000",
    }),
  ],
});
```

**Client config (`src/lib/auth-client.ts`):**
```typescript
import { passkeyClient } from "@better-auth/passkey/client";

export const authClient = createAuthClient({
  plugins: [passkeyClient()],
});
```

**Database migration:** Run `pnpm dlx @better-auth/cli migrate` or add the `passkey` table to the Prisma schema manually based on the plugin's schema requirements.

### Registration Flow

Passkeys are registered AFTER the user has an account (not during initial signup). On the account page:

1. User clicks "Add Passkey"
2. Browser prompts for biometric/PIN/security key
3. Credential is created and stored in the `passkey` table
4. User can name the passkey (e.g. "MacBook Touch ID", "YubiKey")
5. Passkey appears in the list of registered authenticators

### Sign-In Flow

On the login page:
1. Show a "Sign in with Passkey" button alongside the email/password form
2. User clicks → browser shows available passkeys
3. User authenticates with biometric/PIN/key
4. Session created, user logged in

### Conditional UI (Autofill)

Better Auth's passkey plugin supports WebAuthn conditional UI:
- Add `autocomplete="username webauthn"` to the email input on the login page
- On page load, call `authClient.signIn.passkey({ autoFill: true })` to preload passkey suggestions
- If the user has a registered passkey for this site, the browser's autofill shows it alongside saved passwords

### Passkey Management (Account Page)

In the account page security section:
- List of registered passkeys with name, creation date, last used date
- "Rename" button per passkey (update the display name)
- "Delete" button per passkey (with confirmation — especially if it's their only auth method)
- "Add Passkey" button

### Safety: Prevent Lockout

Before allowing a user to delete their last passkey:
- Check if they have a password set
- Check if they have other auth methods (social, SSO)
- If the passkey is their ONLY way to log in, block deletion with a warning: "This is your only sign-in method. Add a password or another authentication method before removing it."

---

## 3. Social Login Providers

### Supported Providers

Add social login via Better Auth's built-in social provider support:

| Provider | Use Case | Config Required |
|----------|----------|----------------|
| **Google** | Most common, works for Google Workspace orgs too | Client ID + Secret from Google Cloud Console |
| **Microsoft** | For Azure AD personal/work accounts | Client ID + Secret from Azure App Registration |
| **GitHub** | Developer-oriented teams | Client ID + Secret from GitHub OAuth Apps |
| **Apple** | iOS/macOS users, privacy-focused | Service ID + Key from Apple Developer |

### Server Config

```typescript
export const auth = betterAuth({
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
    microsoft: {
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
    apple: {
      clientId: process.env.APPLE_CLIENT_ID!,
      clientSecret: process.env.APPLE_CLIENT_SECRET!,
    },
  },
});
```

Social providers are only enabled if their env vars are set. The login page dynamically shows buttons for configured providers.

### Login Page Integration

The login page layout varies depending on whether the user is on the global `/login` or an org-specific `/login/[orgSlug]` page, and whether that org has SSO configured.

#### Global Login (`/login`) — No SSO Context

When no org SSO is in play (the user hasn't been routed to an org-specific page yet), show social providers and email/password on equal footing:

```
[G] Continue with Google
[M] Continue with Microsoft
[  ] Continue with GitHub
[  ] Continue with Apple
─────── or ───────
Email: [____________]
Password: [____________]
[Sign In]
```

#### Org Login (`/login/[orgSlug]`) — SSO Configured

When the org has SSO enabled, the SSO button is visually prioritised: larger, at the top, with a clear visual gap separating it from the other options. The goal is to make the org SSO the obvious default action while still allowing other methods for edge cases (e.g. service accounts, external collaborators who aren't in the IdP).

```
┌─────────────────────────────────┐
│  [🔒] Sign in with Okta SSO    │   ← Large, prominent, primary colour
│       Recommended for           │
│       Acme Corp employees       │
└─────────────────────────────────┘

          ╌╌╌╌╌╌╌╌╌╌╌╌╌          ← Visual gap / subtle divider
       Other sign-in options       ← Muted label

[G] Continue with Google            ← Standard size, secondary style
[M] Continue with Microsoft
[  ] Continue with GitHub
─────── or ───────
Email: [____________]
Password: [____________]
[Sign In]
```

Key visual hierarchy rules:
- The SSO button is **full-width, taller (56px+), primary variant** with the org's SSO provider name and a lock/shield icon
- A subtitle "Recommended for [Org Name] employees" reinforces that this is the intended path
- Below the SSO button, a generous gap (24px+) with a muted "Other sign-in options" label creates separation
- Social login buttons below are **standard size, outline/secondary variant** — visually subordinate
- If the org has `enforceSSO: true`, the social login buttons and email/password form are hidden entirely — only the SSO button is shown
- If the org has `allowPasswordLogin: false` (from the SSO spec), the email/password form is hidden but social login buttons remain visible

#### Org Login (`/login/[orgSlug]`) — No SSO

If the org doesn't have SSO configured, the page looks the same as the global login but with the org's branding (name, logo) at the top. Social and email/password are shown at equal weight.

#### Smart Routing from Global Login

When a user enters their email on the global `/login` page and the email domain matches an org with SSO:
1. Redirect to `/login/[orgSlug]` where the SSO button is prominent
2. Pre-fill the email so the user doesn't have to type it again
3. The SSO-first layout naturally guides them to click the SSO button

This means even users who start at the global login end up seeing SSO prominently if their org has it configured.

### Account Linking

If a user already has an email/password account and then signs in with Google using the same email:
- Better Auth links the social account to the existing user (via the `Account` table)
- The user can now sign in with either method
- The account page shows linked social accounts

If a user signs up with Google first, then later wants to add a password:
- They go to Account > Security > "Set Password"
- This creates a credential account alongside their social account

### Account Page: Linked Accounts

Show a "Connected Accounts" section:
- List of linked social providers with icon, provider name, and linked email
- "Disconnect" button per provider (with lockout prevention — can't disconnect the only auth method)
- "Connect" buttons for providers not yet linked

---

## 4. Account Page Enhancements

### Redesigned `/account` Page

Restructure the existing account page into clear sections:

**Profile Section**
- Avatar (with upload/change/remove)
- Name (editable)
- Email (editable with re-verification)
- Phone number (new optional field)
- Bio/description (new optional field)
- Theme preference (currently in settings — move to account or keep in both)

**Security Section**
- Password: Change password button (or "Set Password" if they only have social/passkey auth)
- Two-Factor Authentication: existing TOTP setup (already implemented)
- Passkeys: list of registered passkeys with add/rename/delete
- Connected Accounts: linked social providers with connect/disconnect
- Active Sessions: existing session list with "Sign out other sessions" button

**Organisations Section**
- List of orgs the user belongs to (existing)
- Role in each org
- "Leave Organisation" button per org

**Danger Zone**
- "Delete Account" — with confirmation dialog, only if they're not the sole owner of any org

---

## 5. Data Model Changes

### User Model Updates

```prisma
model User {
  // ... existing fields ...
  phone       String?    // Optional phone number
  bio         String?    // Short bio/description
}
```

The `image` field already exists — just needs to be populated via upload.

### Passkey Table

Added by Better Auth's passkey plugin (auto-migrated):
```prisma
model Passkey {
  id                  String   @id
  name                String?
  publicKey           String
  userId              String
  user                User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  credentialID        String   @unique
  counter             Int
  deviceType          String
  backedUp            Boolean
  transports          String?
  createdAt           DateTime @default(now())

  @@index([userId])
}
```

### Account Table

Already exists in Better Auth's schema — social providers create entries here with `providerId` = "google", "github", etc.

---

## 6. Server Actions

### `src/server/user-profile.ts` — Update Existing

Add:
```typescript
export async function updateUserProfile(data: { name?: string; phone?: string; bio?: string }): Promise<User>;
export async function uploadProfilePicture(formData: FormData): Promise<{ url: string }>;
export async function removeProfilePicture(): Promise<void>;
export async function getLinkedAccounts(): Promise<LinkedAccount[]>;
export async function deleteUserAccount(): Promise<void>;
```

Passkey and social login operations are handled by Better Auth's client methods directly — no custom server actions needed for those.

---

## 7. Auth Configuration Changes

### Updated `src/lib/auth.ts`

```typescript
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { twoFactor } from "better-auth/plugins";
import { admin } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { sso } from "@better-auth/sso";         // From SSO spec

export const auth = betterAuth({
  // ... existing config ...
  plugins: [
    organization(),
    twoFactor({ issuer: "RVLT Flow" }),
    admin(),
    passkey({
      rpID: process.env.PASSKEY_RP_ID || "localhost",
      rpName: process.env.PLATFORM_NAME || "RVLT Flow",
      origin: process.env.BETTER_AUTH_URL || "http://localhost:3000",
    }),
    sso({ /* ... from SSO spec ... */ }),
  ],
  socialProviders: {
    ...(process.env.GOOGLE_CLIENT_ID && {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
    }),
    ...(process.env.MICROSOFT_CLIENT_ID && {
      microsoft: {
        clientId: process.env.MICROSOFT_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
      },
    }),
    ...(process.env.GITHUB_CLIENT_ID && {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      },
    }),
    ...(process.env.APPLE_CLIENT_ID && {
      apple: {
        clientId: process.env.APPLE_CLIENT_ID,
        clientSecret: process.env.APPLE_CLIENT_SECRET!,
      },
    }),
  },
});
```

### Updated `src/lib/auth-client.ts`

```typescript
import { passkeyClient } from "@better-auth/passkey/client";
import { ssoClient } from "@better-auth/sso/client";

export const authClient = createAuthClient({
  plugins: [passkeyClient(), ssoClient()],
});
```

### New Environment Variables

```
GOOGLE_CLIENT_ID          # Google OAuth
GOOGLE_CLIENT_SECRET
MICROSOFT_CLIENT_ID       # Microsoft OAuth
MICROSOFT_CLIENT_SECRET
GITHUB_CLIENT_ID          # GitHub OAuth
GITHUB_CLIENT_SECRET
APPLE_CLIENT_ID           # Apple Sign In
APPLE_CLIENT_SECRET
PASSKEY_RP_ID             # WebAuthn relying party ID (e.g. "rvlt.app")
```

All optional — features only activate when their env vars are set.

---

## 8. Security Considerations

1. **Lockout prevention**: Never allow a user to remove their last auth method. Before disconnecting a social provider, removing a passkey, or disabling a password, check that at least one other method remains.

2. **Account linking verification**: When linking a social account, the email from the social provider must match the user's RVLT Flow email (or be verified). This prevents account takeover via a social login with a different email.

3. **Profile picture content**: Consider basic image validation (file type, size, dimensions) but don't implement content moderation for v1. Store avatars with the same org-scoped S3 access controls as other files.

4. **Passkey RP ID must match the domain**: In production, `PASSKEY_RP_ID` must be set to the actual domain (e.g. `rvlt.app`). If it doesn't match, passkeys won't work. Document this clearly in deployment notes.

5. **Social provider token storage**: Better Auth stores OAuth tokens in the `Account` table. These allow account linking but should not be used for ongoing API access to the social provider. They're auth tokens, not API tokens.

6. **Session invalidation**: When a user changes their password, all other sessions should be invalidated (Better Auth handles this). When a user disconnects a social provider, sessions created via that provider should be invalidated.

---

## 9. Mobile & PWA

### Passkeys on Mobile

- iOS: Touch ID / Face ID works natively with WebAuthn in the PWA
- Android: Fingerprint / screen lock works via Credential Manager
- Both platforms support passkey sync (iCloud Keychain, Google Password Manager)

### Social Login on Mobile

- Social login redirects work in the PWA but may open the system browser for the OAuth flow
- After auth, the user is redirected back to the PWA
- Test the redirect flow on both iOS and Android PWA

### Profile Picture

- Camera capture should be available as a file source on mobile
- Crop/resize to square before upload (or do server-side)
- The avatar component should use lazy loading with a blurred placeholder

---

## 10. Implementation Phases

### Phase 1: Profile Pictures
1. Create `UserAvatar` component with initials fallback
2. Add upload flow on the account page (reuse `MediaUploader` or build simpler single-image uploader)
3. Server-side image processing (resize to 256×256 square via `sharp`)
4. Update all user display locations to use `UserAvatar`
5. Storage: global `avatars/{userId}/` path, update file proxy

### Phase 2: Passkeys
1. Install and configure `@better-auth/passkey`
2. Run database migration for `passkey` table
3. Add "Sign in with Passkey" button to login page
4. Add conditional UI (autofill) to login form
5. Add passkey management section to account page (list, add, rename, delete)
6. Implement lockout prevention checks

### Phase 3: Social Login
1. Configure social providers in `src/lib/auth.ts` (conditionally based on env vars)
2. Add social login buttons to `/login` page (and `/login/[orgSlug]`)
3. Add "Connected Accounts" section to account page
4. Implement account linking and disconnect with lockout prevention
5. Handle first-time social login → create user account flow
6. Test mobile PWA redirect flows

### Phase 4: Account Page Redesign
1. Restructure account page into Profile / Security / Organisations / Danger Zone sections
2. Add phone and bio fields
3. Add "Delete Account" with confirmation and validation
4. Polish all interactions with mobile responsiveness

---

## Notes

- Social providers are global (not per-org). Any user can log in with Google regardless of which org they're in. This is intentional — social login is a user-level convenience, not an org-level security control. For org-level auth control, use SSO (separate spec).
- Passkeys are also user-level, not org-level. A passkey registered by a user works across all their org memberships.
- Profile pictures should be quick to load — resize to 256×256 server-side and serve via the existing S3 file proxy. Consider generating a tiny thumbnail (32×32) for inline list usage.
- The `UserAvatar` component will be used extensively across the app (crew, team, activity log, etc.), so build it well as a foundational component early.
- Better Auth handles most of the complex auth logic (token management, session creation, account linking). RVLT Flow's work is primarily UI and configuration.
