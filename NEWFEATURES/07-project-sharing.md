# Feature: Project Sharing — Internal Users, External Guests & Scoped Views

## Summary

Allow organization members to share project pages with two audiences:

1. **Internal users** (RVLT Flow account holders in the same or different org) — the project appears in a "Shared with me" section on their dashboard. Optionally grant edit access.
2. **External guests** (no account) — receive an email with a magic link, verify their email to get a 24-hour guest session, and can view a scoped read-only version of the project.

Both share types support **scope controls** that let the sharer decide exactly what information the recipient can see (e.g. hide financials, internal notes, subhire details, etc.).

> **This is a security-critical feature.** It creates an entirely new access path that bypasses the normal auth + org membership + permission chain. Every aspect must be designed with the assumption that shared links will be forwarded, tokens will be guessed, and scope restrictions will be probed.

---

## Table of Contents

1. [Data Model](#data-model)
2. [Sharing Scopes](#sharing-scopes)
3. [Internal User Sharing](#internal-user-sharing)
4. [External Guest Sharing](#external-guest-sharing)
5. [Guest Authentication Flow](#guest-authentication-flow)
6. [Shared Project View](#shared-project-view)
7. [API Routes](#api-routes)
8. [Server Actions](#server-actions)
9. [Middleware Changes](#middleware-changes)
10. [Email Templates](#email-templates)
11. [UI: Share Dialog](#ui-share-dialog)
12. [UI: Shared With Me](#ui-shared-with-me)
13. [UI: Shared Project Page](#ui-shared-project-page)
14. [PDF Access for Shared Projects](#pdf-access-for-shared-projects)
15. [Security Requirements](#security-requirements)
16. [Permissions](#permissions)
17. [Notifications](#notifications)
18. [Activity Log Integration](#activity-log-integration)
19. [Organization Export/Import](#organization-exportimport)
20. [Mobile & PWA](#mobile--pwa)
21. [Routes Summary](#routes-summary)
22. [Implementation Order](#implementation-order)

---

## 1. Data Model

### New Model: `ProjectShare`

Represents a single share relationship between a project and a recipient.

```prisma
model ProjectShare {
  id              String   @id @default(cuid())
  organizationId  String
  organization    Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  projectId       String
  project         Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  // Who shared it
  sharedById      String
  sharedBy        User     @relation("SharedBy", fields: [sharedById], references: [id], onDelete: Cascade)

  // Recipient — exactly one of these is set
  recipientType   ShareRecipientType  // INTERNAL_USER or EXTERNAL_GUEST
  recipientUserId String?             // Set for INTERNAL_USER shares
  recipientUser   User?    @relation("SharedWith", fields: [recipientUserId], references: [id], onDelete: Cascade)
  recipientEmail  String?             // Set for EXTERNAL_GUEST shares (also set for internal as denormalized lookup)

  // Access level
  accessLevel     ShareAccessLevel    // VIEW or EDIT
  scope           Json                // ShareScope object (see below)

  // Status
  status          ShareStatus         // ACTIVE, REVOKED, EXPIRED
  expiresAt       DateTime?           // Optional expiry date for the entire share

  // Metadata
  message         String?             // Optional message from sharer ("Here's the project for Saturday's gig")
  lastAccessedAt  DateTime?           // Track when recipient last viewed
  accessCount     Int      @default(0) // How many times viewed

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  // Guest access tokens
  guestTokens     GuestAccessToken[]

  @@unique([projectId, recipientUserId])           // One share per internal user per project
  @@unique([projectId, recipientEmail, recipientType]) // One share per email per type per project
  @@index([organizationId])
  @@index([recipientUserId])
  @@index([recipientEmail])
  @@index([projectId])
}

enum ShareRecipientType {
  INTERNAL_USER
  EXTERNAL_GUEST
}

enum ShareAccessLevel {
  VIEW
  EDIT
}

enum ShareStatus {
  ACTIVE
  REVOKED
  EXPIRED
}
```

### New Model: `GuestAccessToken`

Short-lived tokens for email-verified guest sessions.

```prisma
model GuestAccessToken {
  id              String   @id @default(cuid())

  shareId         String
  share           ProjectShare @relation(fields: [shareId], references: [id], onDelete: Cascade)

  // Token (hashed for storage, plain sent via email)
  tokenHash       String   @unique
  email           String                  // Must match share's recipientEmail

  // Verification
  verificationCode String?               // 6-digit code, hashed
  isVerified       Boolean @default(false)
  verifiedAt       DateTime?

  // Session
  sessionToken     String?  @unique      // Issued after verification, used as cookie
  expiresAt        DateTime             // 24 hours after verification
  lastUsedAt       DateTime?

  // Security
  ipAddress        String?
  userAgent        String?
  createdAt        DateTime @default(now())

  @@index([shareId])
  @@index([email])
}
```

---

## 2. Sharing Scopes

The `scope` JSON on `ProjectShare` controls what the recipient can see. Every field defaults to `false` (hidden) for external guests and `true` (shown) for internal users — the sharer explicitly opts IN to showing sensitive sections for guests, or opts OUT for internal users.

### `ShareScope` Interface

```typescript
interface ShareScope {
  // Financial visibility
  showPricing: boolean;          // Unit prices, line totals on equipment
  showFinancialSummary: boolean; // Subtotal, discount, tax, total, deposit
  showInvoiceDetails: boolean;   // invoicedTotal, depositPaid
  showLabourCosts: boolean;      // Crew rates and labour cost summary (requires Crew feature)

  // Notes visibility
  showInternalNotes: boolean;    // Project internal notes (never for guests by default)
  showCrewNotes: boolean;        // Crew notes
  showClientNotes: boolean;      // Client-facing notes
  showLineItemNotes: boolean;    // Per-line-item notes

  // Equipment detail
  showEquipmentList: boolean;    // Line items / equipment list (almost always true)
  showAssetTags: boolean;        // Specific asset tags and serial numbers
  showSubhireItems: boolean;     // Subhired items and subhire supplier info
  showOptionalItems: boolean;    // Items marked as optional

  // Crew (requires Crew Management feature)
  showCrew: boolean;             // Show crew assignments on the project
  showCrewContactDetails: boolean; // Show crew phone/email (only if showCrew is true)
  showCrewShifts: boolean;       // Show per-day shift schedule (only if showCrew is true)
  showCallSheet: boolean;        // Allow viewing/downloading the call sheet PDF

  // Project metadata
  showSchedule: boolean;         // Load in/out, event dates, rental dates
  showLocation: boolean;         // Venue / location details
  showSiteContact: boolean;      // Site contact name, phone, email
  showClient: boolean;           // Client name and details
  showProjectManager: boolean;   // PM name(s) — now sourced from CrewAssignment.isProjectManager
  showStatus: boolean;           // Current project status
  showDescription: boolean;      // Project description

  // Documents
  allowDocumentDownload: boolean;  // Can download PDFs (quote, packing list, etc.)
  documentTypes: string[];         // Which PDF types: ["quote", "packing-list", "call-sheet"] etc. Empty = none.
}
```

### Default Scope Presets

Provide preset templates the sharer can pick from, then customise:

| Preset | Description | Key Settings |
|--------|-------------|-------------|
| **Full Access** | Everything visible | All `true`. Internal users with edit access default to this. |
| **Client View** | What a client should see | Equipment list, pricing, financial summary, schedule, location, status. No internal notes, no asset tags, no subhire, no crew details. |
| **Crew View** | What a crew member needs | Equipment list, asset tags, schedule, location, site contact, crew notes, crew list with shifts, call sheet download. No pricing, no financials, no client details, no labour costs. |
| **Equipment Only** | Just the gear list | Equipment list and schedule only. Nothing else. |
| **Minimal** | Just the project name and dates | Schedule only. |
| **Custom** | User configures everything manually | Starts from the selected preset, user toggles individual fields. |

> **Note on Crew View preset**: This is the most natural fit for sharing with crew members via the Project Sharing feature. When a crew member has a `CrewAssignment` on a project, the sharer may want to auto-share the project with the "Crew View" preset. Consider a convenience feature: when a crew assignment is confirmed, offer to auto-share the project with that crew member using the Crew View scope (if the crew member has an email on file).

---

## 3. Internal User Sharing

### Who Can Be an Internal Recipient

- Any user who has a RVLT Flow account. They do NOT need to be in the same organization.
- The sharer searches by name or email. If the email matches a registered user, it's an internal share.
- If the email does NOT match any registered user, it's an external guest share (see next section).

### What Happens When Shared

1. A `ProjectShare` record is created with `recipientType: INTERNAL_USER` and `recipientUserId`.
2. An email is sent to the user notifying them of the share, with a direct link.
3. The project appears in the recipient's "Shared with me" section.

### Access Levels for Internal Users

- **VIEW**: Read-only access to the project, filtered by scope. The user can view the shared project page but cannot modify anything.
- **EDIT**: Full edit access to the project, as if they were an org member with `project: update` permission. The scope controls still apply for what's VISIBLE, but the user can edit fields within the visible scope. Edit access is only available for internal users, never for external guests.

### Edit Access Constraints

When an internal user has EDIT access:
- They can update line items, project status, notes (within scope)
- They CANNOT delete the project
- They CANNOT share the project with others (only the org member who owns it can share)
- They CANNOT access other org resources (assets, models, clients, etc.) — only the project data itself
- All edits are attributed to the recipient user in the activity log
- The `organizationId` on server actions must be resolved from the `ProjectShare`, NOT from the user's session (the user may not be in the org)

---

## 4. External Guest Sharing

### Flow Overview

```
Org member clicks "Share" → enters email → selects scope → sends invite
         ↓
Guest receives email with magic link containing a one-time token
         ↓
Guest clicks link → lands on verification page
         ↓
Verification page sends a 6-digit code to guest's email
         ↓
Guest enters code → server verifies code + token match
         ↓
Server issues a 24-hour session cookie (guest session)
         ↓
Guest can view the scoped project page for 24 hours
         ↓
After 24 hours → session expires → guest must re-verify email to continue
```

### Why Two-Step Verification (Token + Code)

The magic link token proves the email was received, but email links can be forwarded. The verification code sent at the time of access proves the person currently has access to the email inbox. This prevents:
- Forwarded links granting unauthorized access
- Cached/bookmarked links being reused by someone else on a shared computer
- Link preview bots or email scanners accidentally consuming the token

### Guest Constraints

- **Read-only always.** External guests can NEVER edit anything.
- **No navigation.** Guests see only the shared project page — no sidebar, no search, no other pages.
- **No account creation prompt.** Don't push registration on guests. They're here for one thing.
- **Session scoped to one share.** A guest session token is tied to a specific `ProjectShare`. Having access to one shared project does NOT grant access to other shared projects, even from the same org. Each shared project requires its own verification.

---

## 5. Guest Authentication Flow — Detailed

### Step 1: Share Creation

When an org member shares with an external email:

```typescript
// Server action: createProjectShare
1. Create ProjectShare with recipientType: EXTERNAL_GUEST
2. Generate a cryptographically random invite token (32+ bytes, URL-safe base64)
3. Hash the token with SHA-256 and store in GuestAccessToken.tokenHash
4. Send email with link: /shared/verify?token={plaintext_token}
5. Token record has expiresAt = 7 days from now (invite link expiry)
```

### Step 2: Guest Clicks Link

```typescript
// Page: /shared/verify?token=xxx
1. Look up GuestAccessToken by SHA-256(token)
2. If not found or expired → show "Link expired or invalid" message
3. If found → show "Verify your email" page
4. Send a NEW 6-digit verification code to the email on the token record
5. Store hashed verification code on the token record
6. Code expires in 10 minutes
```

### Step 3: Guest Enters Code

```typescript
// API: POST /api/shared/verify
1. Accept: { token, code }
2. Look up token record, verify code hash matches
3. If code wrong → increment attempt counter. After 5 wrong attempts, invalidate token.
4. If code correct:
   a. Generate a session token (32+ bytes, cryptographically random)
   b. Hash and store as GuestAccessToken.sessionToken
   c. Set GuestAccessToken.isVerified = true, verifiedAt = now()
   d. Set GuestAccessToken.expiresAt = now + 24 hours
   e. Set an HttpOnly, Secure, SameSite=Strict cookie: `gf-guest-session={session_token}`
   f. Redirect to /shared/project/{shareId}
```

### Step 4: Guest Accesses Shared Page

```typescript
// Page: /shared/project/[shareId]
1. Read gf-guest-session cookie
2. Look up GuestAccessToken by SHA-256(session_token)
3. Validate: isVerified, not expired, share status is ACTIVE
4. Load project data filtered by share scope
5. Render scoped project view
```

### Step 5: Session Expiry

After 24 hours, the session cookie is invalid. The guest must:
1. Return to the original email link (or a saved bookmark of the verify page)
2. Go through the verification code flow again
3. Get a new 24-hour session

Alternatively, the shared project page shows a "Session expired — verify your email to continue" prompt with a "Resend code" button (which sends a new code to the same email and allows re-verification without going back to the original email link).

### Token Lifecycle

```
INVITE TOKEN (in email link):
  Created → 7-day expiry → Can be used multiple times to initiate verification
  Each use generates a new verification code
  NEVER reused as a session token

VERIFICATION CODE (sent to email):
  Created → 10-minute expiry → Single use
  5 wrong attempts → token invalidated

SESSION TOKEN (cookie):
  Created after successful verification → 24-hour expiry
  Tied to specific share + email
  HttpOnly, Secure, SameSite=Strict
```

---

## 6. Shared Project View

### Route: `/shared/project/[shareId]`

This is a completely separate page outside the `(app)` layout group. It has:
- NO sidebar
- NO top bar (or a minimal branded bar with the org name/logo only)
- NO search, no command palette
- NO navigation to any other page
- A clear "Shared by [org name]" header
- A "Shared with you by [sharer name]" attribution
- An expiry notice if the guest session is time-limited

### Content Rendering

The page reads the `ShareScope` from the `ProjectShare` record and conditionally renders each section of the project:

```typescript
// Pseudocode for the shared project page
function SharedProjectPage({ share, project }) {
  const scope = share.scope as ShareScope;
  return (
    <SharedLayout orgName={share.organization.name}>
      <ProjectHeader name={project.name} number={project.projectNumber} />

      {scope.showStatus && <StatusBadge status={project.status} />}
      {scope.showDescription && <Description text={project.description} />}

      {scope.showSchedule && <ScheduleCard project={project} />}
      {scope.showLocation && <LocationCard location={project.location} />}
      {scope.showSiteContact && <SiteContactCard project={project} />}
      {scope.showClient && <ClientCard client={project.client} />}
      {scope.showProjectManager && <PMCard pms={project.projectManagers} />}

      {scope.showEquipmentList && (
        <EquipmentTable
          lineItems={project.lineItems}
          showPricing={scope.showPricing}
          showAssetTags={scope.showAssetTags}
          showSubhire={scope.showSubhireItems}
          showOptional={scope.showOptionalItems}
          showNotes={scope.showLineItemNotes}
        />
      )}

      {scope.showCrew && (
        <CrewList
          assignments={project.crewAssignments}
          showContactDetails={scope.showCrewContactDetails}
          showShifts={scope.showCrewShifts}
        />
      )}

      {scope.showCrewNotes && <NotesSection title="Crew Notes" text={project.crewNotes} />}
      {scope.showClientNotes && <NotesSection title="Notes" text={project.clientNotes} />}
      {/* Internal notes are NEVER shown to external guests regardless of scope */}

      {scope.showFinancialSummary && <FinancialSummary project={project} showInvoice={scope.showInvoiceDetails} showLabour={scope.showLabourCosts} />}

      {scope.allowDocumentDownload && scope.documentTypes.length > 0 && (
        <DocumentDownloads shareId={share.id} types={scope.documentTypes} />
      )}
    </SharedLayout>
  );
}
```

### Crew Data in Shared Views

When `showCrew` is true, the shared view shows crew assignments for the project:
- Crew member name and role
- Phase (Bump In, Event, Bump Out, etc.)
- If `showCrewShifts`: per-day call times and end times
- If `showCrewContactDetails`: phone and email for each crew member
- If `showCallSheet`: a "Download Call Sheet" button (adds `"call-sheet"` to the available document types)

**Security**: Crew rates (`rateOverride`, `estimatedCost`) and internal assignment notes (`internalNotes`) are NEVER included in shared views, regardless of scope. Only the crew member's name, role, phase, schedule, and optionally contact details are exposed. The `loadScopedProjectData` function must strip all financial and internal crew data.

### Internal Notes Hard Block

Even if `showInternalNotes` is set to `true` in the scope, the server MUST strip internal notes from the response for `EXTERNAL_GUEST` shares. This is a server-side safety rail — never trust the scope JSON alone for guests.

```typescript
// In the server action that loads shared project data:
if (share.recipientType === "EXTERNAL_GUEST") {
  // Hard override — never expose internal notes to guests
  project.internalNotes = null;
  // Hard override — never expose crew rates/costs to guests
  project.crewAssignments = project.crewAssignments?.map(a => ({
    ...a,
    rateOverride: null,
    estimatedCost: null,
    internalNotes: null,
  }));
  // Also strip any other fields that should NEVER leave the org
}
```

---

## 7. API Routes

### New Routes

| Route | Method | Purpose | Auth |
|-------|--------|---------|------|
| `/api/shared/verify` | POST | Verify guest email code, issue session | None (token-based) |
| `/api/shared/resend-code` | POST | Resend verification code | Token required |
| `/api/shared/documents/[shareId]` | GET | Generate PDF for shared project | Guest session cookie |

### `/api/shared/verify` — POST

Request:
```json
{
  "token": "base64-invite-token",
  "code": "123456"
}
```

Response (success):
```json
{
  "success": true,
  "shareId": "share_xxx",
  "redirectUrl": "/shared/project/share_xxx"
}
```
Sets `gf-guest-session` cookie.

Response (failure):
```json
{
  "success": false,
  "error": "invalid_code",
  "attemptsRemaining": 3
}
```

### `/api/shared/documents/[shareId]` — GET

Query: `?type=quote`

- Validates guest session cookie OR authenticated user session
- Checks share scope: `allowDocumentDownload` must be true, `type` must be in `documentTypes`
- Generates the PDF using the same templates as `/api/documents/[projectId]`
- BUT applies scope filtering: if `showPricing` is false, the PDF must also hide pricing
- Returns the PDF stream

### Security: Rate Limiting

All `/api/shared/*` endpoints MUST be rate-limited:
- `/api/shared/verify`: Max 10 attempts per IP per 15 minutes
- `/api/shared/resend-code`: Max 3 resends per token per hour
- `/api/shared/documents/*`: Max 20 requests per session per hour

---

## 8. Server Actions

### `src/server/project-shares.ts` — New File

```typescript
"use server";

// Share management (requires project:update permission)
export async function createProjectShare(data: CreateShareInput): Promise<ProjectShare>;
export async function updateProjectShare(id: string, data: UpdateShareInput): Promise<ProjectShare>;
export async function revokeProjectShare(id: string): Promise<void>;
export async function deleteProjectShare(id: string): Promise<void>;
export async function getProjectShares(projectId: string): Promise<ProjectShare[]>;

// Shared-with-me (for authenticated users)
export async function getSharedWithMe(): Promise<SharedProject[]>;
export async function getSharedProjectById(shareId: string): Promise<SharedProjectData>;

// Guest access (no org context — uses token/session auth)
export async function initiateGuestVerification(token: string): Promise<{ email: string; maskedEmail: string }>;
export async function verifyGuestCode(token: string, code: string): Promise<{ sessionToken: string; shareId: string }>;
export async function resendGuestCode(token: string): Promise<void>;
export async function getGuestSharedProject(shareId: string, sessionToken: string): Promise<SharedProjectData>;

// Internal helper: load project data filtered by scope
export async function loadScopedProjectData(
  projectId: string,
  organizationId: string,
  scope: ShareScope,
  recipientType: ShareRecipientType
): Promise<ScopedProject>;
```

### `loadScopedProjectData` — The Core Security Function

This function is the single point where scope filtering happens. It:
1. Loads the full project from the database
2. Strips fields based on the scope
3. Applies hard blocks for guest access (internal notes, etc.)
4. Returns only the allowed data

**This function must be the ONLY way shared project data is loaded.** No shared view should ever query the project directly — always go through this function.

```typescript
export async function loadScopedProjectData(
  projectId: string,
  organizationId: string,
  scope: ShareScope,
  recipientType: ShareRecipientType
): Promise<ScopedProject> {
  const project = await prisma.project.findUnique({
    where: { id: projectId, organizationId },
    include: {
      client: scope.showClient,
      location: scope.showLocation,
      projectManager: scope.showProjectManager,
      lineItems: scope.showEquipmentList ? {
        where: {
          // If not showing optional items, filter them out
          ...(scope.showOptionalItems ? {} : { isOptional: false }),
          // If not showing subhire, filter them out
          ...(scope.showSubhireItems ? {} : { isSubhire: false }),
          // Always exclude cancelled
          status: { not: "CANCELLED" },
        },
        include: {
          model: true,
          asset: scope.showAssetTags,
          kit: true,
        },
        orderBy: { sortOrder: "asc" },
      } : false,
      // Crew assignments (requires Crew Management feature)
      crewAssignments: scope.showCrew ? {
        where: {
          status: { in: ["CONFIRMED", "COMPLETED"] }, // Only show confirmed crew to shared views
        },
        include: {
          crewMember: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              image: true,
              // Contact details only if scope allows
              ...(scope.showCrewContactDetails ? { email: true, phone: true } : {}),
            },
          },
          crewRole: { select: { id: true, name: true, color: true, icon: true } },
          shifts: scope.showCrewShifts ? { orderBy: { date: "asc" } } : false,
        },
        orderBy: [{ isProjectManager: "desc" }, { startDate: "asc" }],
      } : false,
    },
  });

  if (!project) throw new Error("Project not found");

  // Apply scope filtering
  const scoped: ScopedProject = {
    id: project.id,
    name: project.name,
    projectNumber: project.projectNumber,
    type: project.type,

    status: scope.showStatus ? project.status : null,
    description: scope.showDescription ? project.description : null,

    // Schedule
    loadInDate: scope.showSchedule ? project.loadInDate : null,
    loadInTime: scope.showSchedule ? project.loadInTime : null,
    eventStartDate: scope.showSchedule ? project.eventStartDate : null,
    eventStartTime: scope.showSchedule ? project.eventStartTime : null,
    eventEndDate: scope.showSchedule ? project.eventEndDate : null,
    eventEndTime: scope.showSchedule ? project.eventEndTime : null,
    loadOutDate: scope.showSchedule ? project.loadOutDate : null,
    loadOutTime: scope.showSchedule ? project.loadOutTime : null,
    rentalStartDate: scope.showSchedule ? project.rentalStartDate : null,
    rentalEndDate: scope.showSchedule ? project.rentalEndDate : null,

    // Location
    location: scope.showLocation ? project.location : null,

    // Contact
    siteContactName: scope.showSiteContact ? project.siteContactName : null,
    siteContactPhone: scope.showSiteContact ? project.siteContactPhone : null,
    siteContactEmail: scope.showSiteContact ? project.siteContactEmail : null,

    // Client
    client: scope.showClient ? project.client : null,

    // PM — now sourced from crewAssignments with isProjectManager flag
    projectManagers: scope.showProjectManager ? (project.crewAssignments || [])
      .filter(a => a.isProjectManager)
      .map(a => ({ name: `${a.crewMember.firstName} ${a.crewMember.lastName}` }))
      : null,
    // Legacy fallback: if no crew assignments, use project.projectManager
    projectManager: scope.showProjectManager && !project.crewAssignments?.some(a => a.isProjectManager)
      ? project.projectManager : null,

    // Notes — HARD BLOCK internal notes for guests
    crewNotes: scope.showCrewNotes ? project.crewNotes : null,
    clientNotes: scope.showClientNotes ? project.clientNotes : null,
    internalNotes: (recipientType === "EXTERNAL_GUEST") ? null : (scope.showInternalNotes ? project.internalNotes : null),

    // Equipment
    lineItems: scope.showEquipmentList ? project.lineItems.map(li => ({
      ...li,
      unitPrice: scope.showPricing ? li.unitPrice : null,
      lineTotal: scope.showPricing ? li.lineTotal : null,
      discount: scope.showPricing ? li.discount : null,
      duration: scope.showPricing ? li.duration : null,
      pricingType: scope.showPricing ? li.pricingType : null,
      notes: scope.showLineItemNotes ? li.notes : null,
      asset: scope.showAssetTags ? li.asset : null,
      // Strip internal checkout/return metadata for guests
      checkedOutAt: null,
      checkedOutById: null,
      returnedAt: null,
      returnedById: null,
    })) : [],

    // Crew assignments — ALWAYS strip rates and internal notes for shared views
    crewAssignments: scope.showCrew ? (project.crewAssignments || []).map(a => ({
      id: a.id,
      crewMember: a.crewMember,
      crewRole: a.crewRole,
      phase: a.phase,
      isProjectManager: a.isProjectManager,
      startDate: a.startDate,
      startTime: a.startTime,
      endDate: a.endDate,
      endTime: a.endTime,
      notes: a.notes,           // Assignment notes (visible to crew)
      shifts: scope.showCrewShifts ? a.shifts : [],
      // NEVER expose these in shared views:
      // rateOverride, estimatedCost, estimatedHours, internalNotes, rateType
    })) : [],

    // Financials
    subtotal: scope.showFinancialSummary ? project.subtotal : null,
    discountPercent: scope.showFinancialSummary ? project.discountPercent : null,
    discountAmount: scope.showFinancialSummary ? project.discountAmount : null,
    taxAmount: scope.showFinancialSummary ? project.taxAmount : null,
    total: scope.showFinancialSummary ? project.total : null,
    depositPercent: scope.showFinancialSummary ? project.depositPercent : null,
    depositPaid: scope.showInvoiceDetails ? project.depositPaid : null,
    invoicedTotal: scope.showInvoiceDetails ? project.invoicedTotal : null,
    // Labour costs — only if explicitly scoped AND financials are visible
    labourCostTotal: (scope.showLabourCosts && scope.showFinancialSummary) ? project.labourCostTotal : null,
  };

  return serialize(scoped);
}
```

---

## 9. Middleware Changes

### New Public Routes

Add to the middleware exemption list:
```typescript
const publicPaths = [
  // ... existing ...
  "/shared",          // All shared project routes
  "/api/shared",      // All shared API routes
];
```

### Guest Session Validation

For `/shared/project/[shareId]` pages, the middleware (or the page itself) must validate the guest session:
1. Check for `gf-guest-session` cookie
2. If present: validate session token against `GuestAccessToken` table
3. If valid: allow access
4. If absent/invalid: check for authenticated user session → check `ProjectShare` for internal share
5. If neither: redirect to `/shared/verify` or show "Access denied"

**IMPORTANT**: The guest session check must happen BEFORE any project data is loaded. Never load data first and then check auth.

### Cookie Configuration

```typescript
// Guest session cookie settings
{
  name: "gf-guest-session",
  httpOnly: true,
  secure: true,                    // HTTPS only
  sameSite: "strict",              // No cross-site requests
  path: "/shared",                 // Only sent to /shared/* routes
  maxAge: 86400,                   // 24 hours
}
```

The `path: "/shared"` restriction is critical — it ensures the guest cookie is never sent to authenticated routes, preventing any possibility of guest tokens interfering with normal auth sessions.

---

## 10. Email Templates

### Share Invitation Email (Internal User)

Subject: `[Sharer Name] shared a project with you — [Project Name]`

Body:
- "[Sharer Name] from [Org Name] has shared a project with you."
- Project name, dates (if scope allows), brief info
- Optional message from sharer
- "View Project" button → links to `/shared/project/[shareId]` (or directly to `/projects/[id]` if they're in the same org)
- Access level badge: "View only" or "Can edit"

### Share Invitation Email (External Guest)

Subject: `[Sharer Name] shared a project with you — [Project Name]`

Body:
- "[Sharer Name] from [Org Name] has shared project details with you."
- Project name, dates (if scope allows)
- Optional message from sharer
- "View Project" button → links to `/shared/verify?token=xxx`
- "You'll need to verify your email address to access this project."
- Small print: "This link expires in 7 days."

### Verification Code Email

Subject: `Your verification code: 123456`

Body:
- "Enter this code to access the shared project:"
- Large, prominent 6-digit code
- "This code expires in 10 minutes."
- "If you didn't request this, you can ignore this email."

### Share Revoked Email (optional but recommended)

Subject: `Access to [Project Name] has been revoked`

Body:
- "[Sharer Name] has revoked your access to [Project Name]."
- "You can no longer view this project."

---

## 11. UI: Share Dialog

### Trigger

A "Share" button on the project detail page (`/projects/[id]`). Icon: `Share2` or `UserPlus`. Located in the project header actions area.

### Dialog Layout

**Step 1: Add Recipients**
- Email input field with autocomplete that searches org members by name/email
- As the user types:
  - If matches a RVLT Flow user → show their name + avatar + "RVLT Flow User" badge
  - If no match → show "Invite as guest" option with the typed email
- "Add" button adds the recipient to a list below the input
- Each recipient in the list shows:
  - Name or email
  - Type badge: "Member" (internal) or "Guest" (external)
  - Access level toggle: "Can view" / "Can edit" (edit only for internal users)
  - Remove button

**Step 2: Configure Scope**
- Preset selector: "Client View", "Crew View", "Full Access", "Equipment Only", "Minimal", "Custom"
- Selecting a preset fills in the toggles below
- Toggle grid showing all scope options, grouped by category:
  - **Financials**: Pricing, Financial Summary, Invoice Details
  - **Notes**: Internal Notes, Crew Notes, Client Notes, Line Item Notes
  - **Equipment**: Equipment List, Asset Tags, Subhire Items, Optional Items
  - **Project Info**: Schedule, Location, Site Contact, Client, Project Manager, Status, Description
  - **Documents**: Allow Downloads, Document Types (checkboxes for each PDF type)
- Internal notes toggle is disabled (greyed out, forced off) when any recipient is an external guest

**Step 3: Send**
- Optional message text area ("Add a message for recipients")
- Optional expiry date picker ("Access expires on...")
- "Share" button sends invites

### Managing Existing Shares

Below the "add new" section, show a list of current shares:
- Each row: recipient name/email, type badge, access level, scope preset name, shared date, last accessed, access count
- Actions per row: Edit scope, Change access level, Revoke access, Remove entirely
- Visual indicator for expired or revoked shares

---

## 12. UI: Shared With Me

### Dashboard Integration

On the main dashboard (`/dashboard`), add a "Shared with me" section that shows projects shared with the current user by other orgs/users. This section only appears if the user has any active shares.

Each card shows:
- Project name and number
- Shared by (name + org name)
- Access level badge
- Last accessed date
- "View" button → navigates to the shared project view

### Dedicated Page (Optional)

Consider a `/shared` page that lists all projects shared with the current user, with search and filtering. This is useful if users accumulate many shared projects.

---

## 13. UI: Shared Project Page

### Route: `/shared/project/[shareId]`

Layout:
- Minimal top bar: org logo (if available) + org name + "Shared Project" label
- For authenticated users: small "Back to dashboard" link
- For guests: "Shared with you by [sharer name] from [org name]" + session expiry timer
- Main content: project data rendered according to scope (see Section 6)
- Footer: "Powered by RVLT Flow" branding (optional)

### For Internal Users with Edit Access

If the share has `accessLevel: EDIT`, the shared project page should render an editable version:
- Editable fields based on scope (e.g., if `showCrewNotes` is true, crew notes are editable)
- Line item modifications (add, remove, update quantities — within the visible scope)
- Status changes
- Save button that calls update actions
- All writes go through the `ProjectShare` auth path, not the normal org auth path

### For Guests

- Completely read-only
- No edit buttons, no forms, no mutations
- Print button (browser print)
- PDF download buttons (if scope allows)
- Session expiry countdown or warning when < 1 hour remaining
- "Session expired" overlay with "Verify email to continue" button when token expires

---

## 14. PDF Access for Shared Projects

When a shared user downloads a PDF:
1. The request goes to `/api/shared/documents/[shareId]?type=quote`
2. The API route validates the session (guest or authenticated)
3. Checks scope: `allowDocumentDownload` and `type` in `documentTypes`
4. Calls the same PDF rendering templates as `/api/documents/[projectId]`
5. BUT passes a `scopeFilter` to the template that hides fields based on the share scope

The PDF templates need to accept an optional `scope` parameter:
- If `showPricing` is false → hide unit price and line total columns
- If `showFinancialSummary` is false → hide the financial summary section
- If `showSubhireItems` is false → exclude subhire line items
- If `showAssetTags` is false → hide asset tag column
- If `showLabourCosts` is false → hide labour cost sections
- If `type` is `call-sheet` and `showCallSheet` is true → generate the call sheet PDF (see Crew Management spec), but strip crew rates and internal assignment notes from the output

This means a small refactor to the existing PDF templates to accept and respect a scope object.

### Crew-Specific Document: Call Sheet via Shared Link

The call sheet PDF (defined in the Crew Management spec) can be made available through shared links. When `showCallSheet` is `true` in the scope, add `"call-sheet"` to the available `documentTypes`. The shared call sheet must:
- Show crew names, roles, call times, and phases
- Show crew contact details only if `showCrewContactDetails` is also true in the scope
- NEVER show crew rates or internal assignment notes
- Require a `date` query param (same as the authenticated call sheet endpoint)

### Integration: Auto-Share with Crew Members

When the Crew Management feature is implemented, consider these convenience integrations:
- When a `CrewAssignment` is confirmed, offer to auto-share the project with the crew member using the "Crew View" scope preset
- If the crew member has a `userId` (platform account), create an `INTERNAL_USER` share
- If the crew member has only an `email` (no account), create an `EXTERNAL_GUEST` share
- This auto-share should be configurable at the org level (on by default, can be disabled in settings)
- The crew portal (see Crew Management spec Section 13) and project sharing guest access are separate systems, but a crew member may end up with access through BOTH paths — this is fine, they serve different purposes (portal = schedule overview across all projects; shared project = detailed view of one project)

---

## 15. Security Requirements

### CRITICAL: These are non-negotiable

1. **Token entropy**: All tokens (invite, verification code, session) must use `crypto.randomBytes(32)` or equivalent. Never use `Math.random()` or UUIDs for security tokens.

2. **Token hashing**: Store only SHA-256 hashes of tokens in the database. The plaintext is sent to the user but never stored.

3. **Server-side scope enforcement**: The `ShareScope` is advisory on the client but ENFORCED on the server. The `loadScopedProjectData` function must strip every field that the scope doesn't allow. Never rely on the client to hide fields.

4. **No org context leakage**: Shared views must NEVER expose organization-internal data beyond what the scope allows. This includes:
   - No asset IDs that could be used to probe other endpoints
   - No user IDs beyond the project manager name
   - No organization metadata, settings, or member lists
   - No links to internal pages (all links in shared view should stay within `/shared/`)

5. **Rate limiting on all guest endpoints**: Every `/api/shared/*` endpoint must be rate-limited per IP to prevent brute-force attacks on tokens and verification codes.

6. **Verification code brute-force protection**: After 5 wrong code attempts, invalidate the token entirely. The user must click the email link again to get a new code.

7. **Guest cookie isolation**: The `gf-guest-session` cookie must have `path: "/shared"` so it's never sent to authenticated routes. Guest sessions must never interfere with or be confused with authenticated sessions.

8. **No IDOR on share IDs**: Share IDs are CUIDs (not guessable), but always validate that the requesting user/session has access to the specific share. Never load a share by ID alone — always also check `recipientUserId` or guest session token.

9. **Revocation is immediate**: When a share is revoked, all associated `GuestAccessToken` records must be invalidated immediately. The next request from a guest with a revoked share must fail, even if their session hasn't expired.

10. **Audit trail**: Every share creation, modification, access, and revocation must be logged (if activity log is implemented). Guest accesses should also be logged with IP and user agent.

11. **Template exclusion**: Shared projects must NOT be templates (`isTemplate: false` check on share creation).

12. **No recursive sharing**: A user who received a share cannot re-share the project. Only org members with `project: update` permission can create shares.

13. **Edit access validation**: For internal users with EDIT access, every write operation must re-validate the share status (ACTIVE, not expired, not revoked) before executing. Don't just check at page load.

14. **Input sanitization on scope**: The `scope` JSON stored in `ProjectShare` must be validated against the `ShareScope` schema on creation and on every read. Malformed scope JSON should be treated as "deny all".

---

## 16. Permissions

### Who Can Share

Sharing requires `project: update` permission on the org. This means `owner`, `admin`, `manager`, and `member` roles can share. `viewer` cannot share.

### New Permission (Optional)

Consider adding a `share` action to the `project` resource:
```typescript
project: ["create", "read", "update", "delete", "share"]
```

This allows finer-grained control — e.g., members can edit projects but only managers can share them. If this is too disruptive, gate sharing behind `project: update` for now.

---

## 17. Notifications

### For Internal Users

When a project is shared with an internal user, generate a notification:
```typescript
{
  type: "project_shared",
  title: "[Sharer] shared a project with you",
  description: project.name,
  href: "/shared/project/[shareId]",
}
```

Add `project_shared` to the notification types in `src/server/notifications.ts`.

### For Share Owners

When a shared user accesses the project for the first time, optionally notify the sharer:
```typescript
{
  type: "share_accessed",
  title: "[Recipient] viewed [Project Name]",
  href: "/projects/[projectId]",
}
```

---

## 18. Activity Log Integration

If the Activity Log feature is implemented, log:
- Share created: `{ action: "SHARE_CREATED", entityType: "project", recipientEmail, accessLevel, scope preset }`
- Share modified: `{ action: "SHARE_UPDATED", entityType: "project", changes }`
- Share revoked: `{ action: "SHARE_REVOKED", entityType: "project", recipientEmail }`
- Share accessed: `{ action: "SHARE_ACCESSED", entityType: "project", recipientEmail, recipientType, ipAddress }`
- Guest verified: `{ action: "GUEST_VERIFIED", entityType: "project", email, ipAddress }`

---

## 19. Organization Export/Import

Add `ProjectShare` and `GuestAccessToken` to:
- `src/lib/org-export.ts` — export both tables
- `src/lib/org-import.ts` — import with ID remapping for `projectId`, `sharedById`, `recipientUserId`

On import, `GuestAccessToken` records should probably be cleared (don't import active guest sessions into a new org).

---

## 20. Mobile & PWA

### Shared Project Page

- Must be fully responsive — guests may be viewing on mobile
- No sidebar or bottom nav (this is a standalone page)
- Safe area padding on the minimal top bar
- Touch-friendly document download buttons
- Session expiry warning should be prominent on mobile (banner at top)

### Share Dialog

- Full-screen on mobile with safe area padding (same pattern as other RVLT Flow dialogs)
- Scope toggles should be in an accordion/collapsible layout on mobile to avoid overwhelming scroll

---

## 21. Routes Summary

| Route | Layout | Auth | Purpose |
|-------|--------|------|---------|
| `/shared/verify` | Minimal (auth-style centered card) | None | Guest email verification page |
| `/shared/project/[shareId]` | Minimal (branded bar only) | Guest session OR authenticated user | Scoped project view |
| `/api/shared/verify` | — | Token-based | POST: verify code, issue session |
| `/api/shared/resend-code` | — | Token-based | POST: resend verification code |
| `/api/shared/documents/[shareId]` | — | Guest session OR authenticated | GET: scoped PDF generation |

### Middleware Exemptions

Add to public routes in `src/middleware.ts`:
```typescript
"/shared",
"/api/shared",
```

---

## 22. Implementation Order

This feature is large. Suggested implementation phases:

### Phase 1: Core Data Model & Internal Sharing
1. Create `ProjectShare` model and migration
2. Implement `createProjectShare`, `revokeProjectShare`, `getProjectShares` server actions
3. Build the Share dialog UI (internal users only)
4. Build `loadScopedProjectData` function with full scope filtering
5. Build the `/shared/project/[shareId]` page for authenticated internal users
6. Add "Shared with me" section to dashboard
7. Send share notification emails (internal)

### Phase 2: External Guest Access
1. Create `GuestAccessToken` model and migration
2. Build `/shared/verify` page and email verification flow
3. Implement guest session cookie management
4. Build the guest version of `/shared/project/[shareId]`
5. Add rate limiting to all `/api/shared/*` endpoints
6. Send guest invitation and verification emails
7. Add session expiry UI and re-verification flow

### Phase 3: Edit Access & Documents
1. Implement edit capabilities for internal users with EDIT access
2. Add scoped PDF generation via `/api/shared/documents/[shareId]`
3. Refactor PDF templates to accept and respect scope parameter

### Phase 4: Polish & Security Hardening
1. Full security audit of all token flows
2. Rate limiting tuning
3. Activity log integration
4. Share management UI on project detail page
5. Mobile responsiveness pass
6. Org export/import support

---

## Notes

- The `ProjectShare.scope` JSON is the single source of truth for what a recipient can see. All rendering decisions (web page AND PDF) must flow through this scope.
- External guest shares are inherently more restricted than internal shares. The server must enforce hard limits on guest access regardless of what the scope says.
- Consider adding an org-level setting to disable external sharing entirely (for orgs that don't want any data leaving the platform). This would be a boolean in `Organization.metadata` that gates the "Invite as guest" option in the share dialog.
- The share dialog should warn the sharer when they're about to expose financial data to an external guest — a confirmation like "This will show pricing information to someone outside your organization."
- Consider watermarking PDFs downloaded via shared links with the recipient's email address. This discourages unauthorized redistribution.
- Long-term: support sharing other entity types (assets, kits, maintenance records). For now, only projects.
