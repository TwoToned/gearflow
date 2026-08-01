# Onboarding & activation — signup, org setup, first-run tour

> _Owner: Jayden Nawotka · Last reviewed: 2026-08-01 (review quarterly — POLICY.md R-5.5)_

**Created:** 2026-08-01
**Status:** Design — not started. No code written.
**Binding constraints:** [`POLICY.md`](../../POLICY.md) (profile `WEB`), [`DESIGN.md`](../../DESIGN.md).
**Supersedes:** the "In-App Onboarding Tour" P3 entry in [`TODOS.md`](../../TODOS.md) (which
scoped this as "~3–4 days, no schema or server work beyond a tour-completed flag" — that
estimate assumed single-org and is wrong, see §2).
**Related:** [FEATUREDOCS/04](../../FEATUREDOCS/04-auth-permissions.md) (auth, single-org mode),
[FEATUREDOCS/20](../../FEATUREDOCS/20-csv-import-export.md) (CSV import),
[FEATUREDOCS/27](../../FEATUREDOCS/27-settings-admin.md) (org settings),
[FEATUREDOCS/51](../../FEATUREDOCS/51-project-numbering.md) (numbering).

---

## 1. What we're building

A new user's first fifteen minutes, end to end:

```
sign up → who are you? → create org ─→ guided org setup ─→ get your gear in ─→ activation tour
                       └→ join org  ─→ (approval) ──────────────────────────→ activation tour
```

Two deliverables that share one spine:

- **Setup** — a guided, resumable wizard that takes a brand-new organisation from
  nothing to "can legally send a quote": identity, tax, brand, numbering, document
  terms, locations, team.
- **Activation** — a state-derived checklist that coaches the first real unit of
  work: *add a model → stock it with an asset → create a project → put the model on
  the project*. Real data, no sandbox.

---

## 2. Research — what the codebase actually does today

This section is the reason the TODOS.md estimate is wrong by an order of magnitude.

### 2.1 The app is single-org per deployment

| Pin | Location |
|---|---|
| `organizationLimit: 1` | `src/lib/auth.ts:93` |
| `getTheOrg()` = `organization.findFirst()`, 5-min process cache | `src/lib/single-org.ts` |
| `user.create` hook auto-joins **every** signup to that org (first user → `owner`, rest → `member`) | `src/lib/auth.ts:238-262` |
| Convex JWT `orgId` claim minted from `getTheOrg()` | `src/lib/auth.ts:154-166` |
| `requireOrganization()` / `getActiveOrganizationId()` return the singleton, ignoring the session | `src/lib/auth-server.ts:20-32` |

Consequence: **the fork the user asked for has no second branch.** Nobody can create a
second org, and "join an org" is what already happens silently to every signup.
`/onboarding` is reachable exactly once per deployment, by the first human.
[FEATUREDOCS/04](../../FEATUREDOCS/04-auth-permissions.md) states this explicitly:
_"multi-org features (org switching, org creation beyond bootstrap, org-specific login
routes) are removed."_

### 2.2 The good news: the *data* layer is already multi-tenant

This was the surprise. Single-org is a pin in the **identity-resolution** layer only —
roughly four chokepoints. Everything underneath is already tenant-scoped and, more
importantly, already *audited*:

- `getOrgContext()` (`src/lib/org-context.ts`) is the single funnel every `src/server/*`
  action passes through. It takes `organizationId` from `requireOrganization()` and
  scopes from there. Change the resolver, and the entire server-action surface becomes
  multi-tenant with no per-action edits.
- Convex has a real per-resource guard: **290 `requireOrgReadFor` / `requireOrgReadDocFor`
  call sites vs 2 bare `requireOrgRead`** — the #998/#1001 sweep did this work already.
  `requireOrgReadDocFor` performs the actual `doc.organizationId !== auth.orgId` rejection
  (`convex/lib/auth.ts:332-339`).
- Secondary lookups already filter defensively — e.g. `convex/models.ts:85`
  `file.organizationId === orgId ? file : null`.
- Per-org counters already exist and are keyed correctly: `ProjectNumberSequence`
  (`@@unique([organizationId, scopeKey])`), asset-tag counters in org metadata,
  invoice-number sequences namespaced under `INV:<period>`.

**No schema change is required to support multiple organisations.** `Organization` and
`Member` are real tables; every domain row already carries `organizationId`.

### 2.3 The bad news: those org checks are currently unfalsifiable

With exactly one org in existence, `doc.organizationId !== auth.orgId` **can never be
true**. Every one of those 290 guards is untested by construction, and every one of the
~1,500 `withIndex("by_cuid")` global-index reads is a latent cross-tenant read that no
test can currently catch. CLAUDE.md already names this class an R-8.4.3 IDOR **Critical**.

Today they are unexploitable. The moment a second organisation exists, every gap is live.
**This is the dominant cost and risk of the whole program** — not the wizard, not the tour.

Mitigation is in §4.5 and it is cheap, because the API registry already enumerates every
agent-reachable operation and `convex/agentServiceUnreachable.test.ts` already proves the
"invoke every operation and assert it rejects" harness works.

### 2.4 Other single-org assumptions found

| Issue | Where | Severity when multi-tenant |
|---|---|---|
| `adminDeleteOrganization` is a bare `prisma.organization.delete` — it never touches Convex, where all domain data now lives, so deleting an org **orphans the entire dataset** | `src/server/site-admin.ts:246` | **High** — orphaned docs keep their `organizationId` and stay reachable by any global-index read that skips its org check (§2.3). See §5.4 |
| `addMemberByEmail` adds an **existing** user to your org with no invitation and no consent | `src/server/settings.ts:240-258` | **High** — any owner can pull any known email into their org |
| WooCommerce webhook falls back to `getTheOrg()` when `?org=` is absent, and the settings page hands out a URL with no org selector at all | `route.ts:52-59`, `settings/woocommerce/page.tsx:183`, `convex/wooCommerceInternal.ts:26` | **Blocking** for that integration — fixed in §4.4 |
| `OrgActivator` heals a missing active-org by calling `getTheOrgId()` | `src/components/providers/org-activator.tsx` | Would silently activate an arbitrary org |
| Site admin is built as a single-org view (11 `getTheOrg` uses) | `src/server/site-admin.ts` | Needs a real org list |
| Registration policy (`OPEN`/`INVITE_ONLY`/`DISABLED`) is platform-global | `SiteSettings` | Now distinct from *per-org* join policy — both are needed |
| SSO is already slug-based (`getOrgLoginInfo(slug)`), and a `pending-approval` + approvals queue already exists | `src/lib/sso-provisioning.ts`, `src/components/settings/sso-pending-approvals.tsx` | **Asset** — reuse for request-to-join |

### 2.5 No tour library is installed, and that is the right answer

`package.json` has no driver.js / shepherd / joyride / onborda. It should stay that way:

- Overlay tour libraries spotlight by portalling a fixed layer over the page. This app has
  **documented scar tissue** exactly there — a Radix modal `Dialog` sets
  `pointer-events: none` on `document.body`, and `OverlayLockReset` exists solely to
  self-heal orphaned inert locks (CLAUDE.md, "DOM Safety"). Adding a third overlay system
  that must coexist with Radix's DismissableLayer *and* the Base UI inert watchdog is
  volunteering for the app's worst historical bug class.
- A better surface already exists: `asset-form.tsx`'s **sticky helper rail**
  (`lg:grid-cols-[1fr_280px]`, `hidden lg:block`), described in FEATUREDOCS/08 as the
  reference pattern for the app's forms. Coaching renders *into the rail*, in-flow, using
  existing design tokens. No portal, no z-index war, no pointer-events lock.

**Decision: no tour library. Coach in-flow (helper rail + checklist), not over-flow.**

---

## 3. Decisions taken

| # | Decision | Rationale |
|---|---|---|
| **D1** | **Go multi-tenant now.** Lift `organizationLimit`, delete `single-org.ts`, remove the auto-join hook, resolve org from the session's active organisation. | User decision, 2026-08-01. Without it there is no "create vs join" fork. |
| **D2** | **Coached real work**, not seeded demo data. Milestones derived by querying real org state. | Nothing to clean up; the user ends with real inventory; deviation-tolerant. |
| **D3** | **Only the org name blocks.** Everything else is skippable and resumable via a "Finish setup" checklist that deep-links into the real settings pages. | A first-run wall is the top cause of setup abandonment, and every deferred field has a safe default. |
| **D4** | Wizard also covers **locations + asset-tag scheme**, **CSV import**, and **document identity** (footer, T&Cs, payment details, invoice numbering). Business-profile/vertical question dropped. | The first two are hard prerequisites for the tour; the third is a prerequisite for the first quote. |
| **D6** | **Org creation is gated by a site-admin toggle + signup code** (§5.3). | User decision, 2026-08-01. Keeps a public instance from accruing unbounded tenants, and lets Phase A ship with the door shut (§10.1). |
| **D7** | **Phase A ships and soaks alone**, before any onboarding UI (§10.1). | User decision, 2026-08-01. All the security risk, none of the user-visible surface. |
| **D8** | **Org logos stay two variants (wide + square), light only** (§6.2). | User decision, 2026-08-01, confirmed against consumers — org branding renders on PDFs only. |
| **D9** | **WooCommerce is made properly multi-org** in Phase A, via an opaque per-org webhook token (§4.4). Not deferred, not flagged single-org. | User decision, 2026-08-01. Most of the tenancy already exists; the gap is the URL the settings page hands out. |
| **D10** | **Abandonment is guarded, not automated** (§5.4): verified email + the signup code prevent, a derived "dormant" predicate detects, capped nudges recover, deletion stays admin-initiated. | User decision, 2026-08-01. Auto-deleting tenants is the one irreversible action here, so it stays human. |
| **D11** | **Billing / trials are out of scope**, revisited after this program. | User decision, 2026-08-01. While creation is code-gated there is no self-serve growth to meter. |

**D5 (mine, flagged for approval):** the wizard writes through the **same server actions the
settings pages already use** (`saveOrgSettings`) and stores **no separate draft state**.
Step completion is *derived* from the org's real settings. This is R-3.1 / R-8.2.4: a
parallel "onboarding draft" blob would be a second hand-maintained copy of every setting,
and it would drift the moment someone edits a value in Settings instead of the wizard.

That decision is what makes D3 cheap: because step 0 creates the org for real, every
later step is an ordinary settings write against a live org. The wizard is not a
transaction to be completed — it is a guided path through screens that already work.

---

## 4. Phase A — Multi-tenancy foundation

**This is a prerequisite program, not part of the onboarding feature.** It should ship,
be audited, and be signed off before any wizard work starts.

### 4.1 The spike that gates everything (do this first, day one)

`src/lib/auth.ts`'s `definePayload: async ({ user }) => …` mints the `orgId` claim on the
Convex JWT. **Every Convex authorization decision in the app derives from that claim.**
The callback currently receives only `user` — it has no access to the session, so it
cannot read `activeOrganizationId`.

Until we know how to get the active org into `definePayload`, multi-tenancy in Convex is
blocked. Three candidate resolutions, in preference order:

1. Better Auth passes `session` to `definePayload` in the installed version (^1.6.25) —
   verify against the actual type signature.
2. Read the session inside the callback via `headers()` (the mint is request-scoped).
3. Move `orgId` out of the JWT and pass it per-call, re-validated server-side. **Expensive
   and invasive — treat as failure.**

Outcome 3 would materially change the cost of Phase A. Spike it before committing.

### 4.2 The four chokepoints

| # | File | Change |
|---|---|---|
| A1 | `src/lib/auth-server.ts` | `requireOrganization()` returns `session.session.activeOrganizationId`, **re-validated against a live `Member` row** on every resolution. Never trust the session blob alone — it is set by a client-callable `organization.setActive()`. Memoize per-request with React `cache()`. |
| A2 | `src/lib/auth.ts` | `definePayload` mints `orgId` from the active org + that user's member row (per §4.1). Keep the existing fresh-read of `role`. |
| A3 | `src/lib/auth.ts` | Raise `organizationLimit`; **delete the `user.create` auto-join hook**. Membership is only ever created by invite-accept, request-approval, or org-create. |
| A4 | login / register / invite / `OrgActivator` | Stop calling `getTheOrgId()`. Login resolves the user's orgs (0 → fork, 1 → activate, 2+ → picker). Invite resolves the org from the invitation row. |

Then delete `src/lib/single-org.ts` and `getTheOrgId`/`getTheOrgInfo`/`getSingleOrgSSOInfo`
from `src/server/public-org.ts`. `mirrorMyMembership` **stays** — it is still required
after every org create (see its docstring; without it the owner has a Postgres membership
and no Convex one, and the app is unusable).

### 4.3 Also required

- **Org switcher** in the sidebar for users with ≥2 memberships; `setActive` + a hard
  refresh of Convex auth (the JWT carries `orgId`, so switching org must re-mint).
- **`addMemberByEmail` becomes invite-only.** Adding an existing user directly is removed;
  every membership requires the recipient to accept.
- **Per-org join policy** (`INVITE_ONLY` | `DOMAIN_REQUEST` | `CLOSED`) in org settings,
  distinct from the platform-global registration policy.
- **WooCommerce webhook tenancy** — opaque per-org token (§4.4).
- **Org deletion must stop orphaning Convex data** (§5.4) — a prerequisite for offering
  deletion at all, which the dormant-org cleanup path needs.
- **Site admin** — real org list, per-org drill-down, dormant filter (§5.4).

### 4.4 WooCommerce multi-org (decided 2026-08-01: fix it, don't defer it)

Smaller than it looked. Most of the tenancy is already there:

- **`WooCommerceIntegration` is already one row per org**, each with its **own
  `webhookSecret`**, and HMAC verification already runs against that per-org secret.
- **The route already accepts `?org=`** (`route.ts` step 5) — `getTheOrg()` is only the
  *fallback* when the param is absent.
- **Downstream is already scoped** — `processWooCommerceOrder(orgId, order, integration)`
  takes the org explicitly and threads it through.

So the multi-org gap is narrow: the settings UI builds the webhook URL **without** any org
selector (`settings/woocommerce/page.tsx:183` — origin + path, nothing else), so every
operator today pastes a URL that only resolves because there is one org.

#### Design: an opaque per-org webhook token in the path

`POST /api/integrations/woocommerce/webhook/<webhookToken>`, where `webhookToken` is a
random unguessable value on `WooCommerceIntegration`, rotatable from the settings page.

Rejected alternative: make `?org=<orgId>` required. It works, it is nearly free, and it is
*secure* — the org id only selects which secret to verify against, so forging it gains
nothing without that org's `webhookSecret`. It is a routing hint, not an authenticator.
Two reasons to spend the extra half-day anyway:

1. **It leaks internal org ids into a third party.** The webhook URL is pasted into a
   customer's WooCommerce admin, and travels through their logs, their screenshots, and
   their support tickets. An opaque token is the thing that belongs there.
2. **`?org=` is an enumeration oracle.** Today step 6 returns `404 "Integration not
   enabled"` *before* signature verification, so an unauthenticated caller can probe org
   ids and learn which orgs have WooCommerce on. With a token, an unknown token and a
   disabled integration must return the **same** response — no oracle.

#### Work items

- Add `webhookToken` to `WooCommerceIntegration` (Convex + settings UI), generated on
  integration create, rotatable. Exactly one existing integration to migrate.
- New route segment; resolve org from the token. Delete the `getTheOrg()` fallback and the
  `?org=` param together — a clean cut, since there is one integration in existence.
- **Delete `getSingleOrg` from `convex/wooCommerceInternal.ts`** (the `getTheOrg` mirror,
  line 26) — it dies with `single-org.ts`.
- Unknown token, disabled integration, and wrong-org token all return an identical
  response.
- Rate-limit the endpoint (`@convex-dev/rate-limiter` is already a dependency).
- The ping path (accepted without HMAC, by design) must sit **behind** token resolution, so
  it cannot be used to probe either.
- Settings UI shows the full tokenised URL with copy-to-clipboard, plus "Rotate" with a
  warning that the WooCommerce end must be updated.

Everything downstream of org resolution is unchanged.

### 4.5 The audit gate (the expensive half)

> A guard that cannot fail is a guard that has never been tested.

**Gate: a two-org adversarial fixture, wired to the API registry, green before Phase B starts.**

Seed Org A and Org B with a full parallel entity set. Then, driven by
`src/lib/api/registry.generated.ts` (which already enumerates every agent-reachable
operation), invoke **every** operation with Org A's identity against Org B's entity ids and
assert rejection. Model it on `convex/agentServiceUnreachable.test.ts`, which already proves
this harness shape works across 602 functions.

Properties that make this the right gate:

- **Exhaustive by construction** — new operations join the registry automatically, so
  coverage cannot silently regress.
- **Ratchetable** — same pattern as the reachability floor in `docs/api-coverage.md`.
- It turns ~1,500 unfalsifiable `by_cuid` reads from "audit by reading code" into
  "audit by running tests", which is the only version that stays true.

Additionally: a lint rule or `depcruise` constraint forbidding new `withIndex("by_cuid")`
reads that are not immediately followed by an org check.

**Effort: L (3–4 weeks human).** The audit dominates; the chokepoint swap is days.

---

## 5. Phase B — The signup fork

### 5.1 Flow

```
/register  →  account created  →  email verification
                                        │
                    ┌───────────────────┴───────────────────┐
             arrived via invite                      no invite
                    │                                       │
            accept → member tour                    /welcome  (the fork)
                                                            │
                              ┌─────────────────────────────┴────────────┐
                    "Set up a new company"                   "Join my team"
                              │                                          │
                          /setup (§6)                    ┌───────────────┴──────────────┐
                                                  invite code            verified-domain match
                                                         │                              │
                                                    join → tour        "3 people at rvlt.app are here"
                                                                        → request → approval queue
                                                                              → notification → tour
```

### 5.2 Notes

- **The fork screen is two large cards**, not a radio group. It is the highest-stakes
  choice in the funnel and deserves the space. Per DESIGN.md: individually-bordered tiles,
  hard offset shadows, no gradients, sentence case.
- **Domain matching requires a verified email.** Otherwise anyone can claim
  `@bigcorp.com` and request into a stranger's org. Gate the domain branch on
  `emailVerified`; the invite-code branch does not need it (possession of the invite is
  the proof).
- **Request-to-join reuses existing machinery** — `pending-approval` page, the SSO
  approvals queue component, and the notification system (FEATUREDOCS/17). Approvals land
  in Settings → Team next to the SSO ones.
- **A user with zero orgs must never be stranded.** `/no-organization` becomes the fork,
  not a dead end.

**Effort: S.**

### 5.3 Gating org creation — the signup code

**Decision (2026-08-01): site admins can require a signup code before anyone may create an
organisation, and set that code, from `/admin/settings`.**

Half of this already exists and is currently vestigial. `SiteSettings.allowOrgCreation`
(migration `20260316000000_add_allow_org_creation`) is present in the Prisma schema, the
Convex schema, `convex/siteSettings.ts` mutation args, the `site-admin.ts` input type, and
is even classified as a privileged arg (`src/lib/api/privileged-args.ts:106`) — but **it is
read by nothing, enforced nowhere, and has no admin UI.** It predates single-org mode. This
phase wakes it up and adds the code beside it.

#### Two independent gates — do not conflate them

| Gate | Field | Controls |
|---|---|---|
| **Account signup** | `SiteSettings.registrationPolicy` (`OPEN` / `INVITE_ONLY` / `DISABLED`) — already enforced in `src/app/(auth)/register/page.tsx` via `/api/registration-policy` | Whether a stranger may create a *user account* |
| **Org creation** | `allowOrgCreation` + the new `orgCreationCode` | Whether an authenticated user may create an *organisation* |

They compose: `registrationPolicy: OPEN` + org creation code required is the expected
public-instance posture — anyone may sign up and join a team they were invited to, but
standing up a new tenant needs the code.

#### Admin surface (`/admin/settings`)

- **Allow organisation creation** — toggle (`allowOrgCreation`). Off ⇒ the "Set up a new
  company" branch of the fork is hidden entirely and the server refuses regardless.
- **Require a signup code** — toggle (`orgCreationCodeEnabled`).
- **Signup code** — text field (`orgCreationCode`), with copy-to-clipboard and a regenerate
  button. Readable back in plaintext by design: the admin has to be able to hand it out,
  which is what separates it from a password.

#### Four security requirements, all non-negotiable

1. **Server is the authority (R-9.3).** The code is verified inside the org-create path,
   server-side. The client never receives the code to compare against, and hiding the fork
   branch in the UI is cosmetic only.
2. **It must never enter any public read.** `SiteSettingsRow` is a flat blob and
   `usePlatformBranding()` pulls site settings into the browser. Today `/api/registration-policy`
   is careful — it returns `{ policy }` and nothing else — and `/api/platform-name` must be
   checked the same way. **`orgCreationCode` must be excluded from `SiteSettingsRow`
   entirely** and read only through a dedicated admin-gated accessor. A field that reaches
   `mapDoc()` reaches every browser on the instance.
3. **Rate-limit attempts.** A shared static code is brute-forceable. `@convex-dev/rate-limiter`
   is already a dependency; limit per-session and per-IP, and log failures to the activity
   log.
4. **Constant-time comparison.** Cheap, removes a timing oracle.

#### Validation

Zod at the trust boundary (R-8.2.3/R-8.6.4) — the code arrives in an HTTP body, so the
route uses `withValidatedBody`, not a bare `request.json()`.

**Effort: S** (folds into Phase B).

### 5.4 Guards against org abandonment

D3 deliberately lets a user skip the entire wizard, so half-configured orgs are a designed-in
possibility, not an accident. Four layers, cheapest first. **Note that none of them delete
anything automatically** — see the cleanup rule below.

#### Prevention

1. **The signup code already does most of the work.** Abandonment risk is proportional to
   how open creation is, and D6 closes it: you cannot create an org without an
   admin-issued code. Casual, accidental and drive-by orgs largely cannot happen. Worth
   stating plainly so this section isn't over-engineered against a risk the gate already
   absorbs — the remaining exposure is people who were *given* a code and drifted off.
2. **Require a verified email before org creation.** Blocks throwaway tenants and pairs
   with the domain-match join path (§5.2), which needs `emailVerified` anyway.
3. The org isn't created until the name step is submitted — already true, nothing to do.

#### Detection — derive "dormant", don't store it

Same principle as D5 and §7.1. An org is **dormant** when all of:

- exactly 1 member, and
- zero activation milestones (no models, no assets, no projects), and
- no activity-log entries since creation, and
- created more than N days ago.

Every one of those is already queryable — the activity log exists (FEATUREDOCS/24) and the
milestone counts exist (§7.1). No new column, no cron to maintain a flag, nothing to drift.

#### Surfacing

**A "Dormant" filter on `/admin/organizations`** with age and owner contact. That is the
whole feature: it converts an invisible accumulation into a list a human can act on.

#### Recovery — nudge, then stop

Resend is already wired (`RESEND_API_KEY`, `EMAIL_FROM`). Day 1 / day 3 / day 7:
"You're two steps from your first quote", deep-linking to the resumable setup checklist —
D3 is what makes that link land somewhere useful. **Hard cap at three, then never again.**
An onboarding sequence that keeps nagging is worse than an abandoned org.

#### Cleanup — admin-initiated only, and it needs a fix first

**Never auto-delete a tenant.** Destroying a customer's org on a timer is exactly the
irreversible action that should require a human. The flow is: admin sees the dormant list →
exports (the export button already exists on `/admin/organizations/[id]`) → deletes behind
a typed confirmation.

> **⚠️ Blocking defect found — `adminDeleteOrganization` is Postgres-only.**
> `src/server/site-admin.ts:246` is a bare `prisma.organization.delete({ where: { id } })`.
> Since the Convex migration, **Postgres holds only Better-Auth + audit models** (CLAUDE.md)
> — every model, asset, project, quote and file lives in Convex. Deleting an org today
> removes the auth rows and **orphans the entire domain dataset in Convex**, unreachable
> and uncounted.
>
> Today that is nearly harmless: one org, never deleted. Under multi-tenant it is a data
> leak (orphaned docs still carry `organizationId` and are reachable by any global-index
> read that skips its org check — precisely the §2.3 class) and an unbounded storage
> liability. **Org deletion must not be offered as a workflow until this is fixed**, which
> makes it Phase A work, not Phase B.

Also worth doing while there: **slug reclamation**, so a squatted slug on a dormant org can
be released without a full delete.

---

## 6. Phase C — The org setup wizard

Route `/setup`. Owner-only. Five screens, sectioned — not eight steps, which tests as a
slog. Every screen after the first has **"Skip for now"**.

| # | Screen | Contents | Blocking? |
|---|---|---|---|
| 0 | **Your company** | Name (+ auto-slug, editable). **Creates the org, sets active, mirrors membership.** | **Yes** |
| 1 | **Where you operate** | Country → *auto-fills* currency, tax rate, tax label, timezone. Email, phone, website, ABN, address (Places autocomplete — `@vis.gl/react-google-maps` is already a dep). | No |
| 2 | **Your brand** | Logo, icon, primary/accent/document colour, `documentLogoMode`. **Live quote-header preview** beside the fields. | No |
| 3 | **How you work** | Project number format (live `peekNextProjectNumber` preview already exists), invoice number format, asset-tag prefix/digits; quote validity days, payment terms days, footer, T&Cs, payment details; **first location**. | No |
| 4 | **Your team** | Invites with a plain-English role explainer (owner/admin/manager/member/warehouse/viewer). | No |
| 5 | **Your gear** | **Import a CSV** (FEATUREDOCS/20) *or* **add your first item by hand** → hands off to Phase D. | No |

### 6.1 Design notes

- **Country is the highest-leverage field in the whole wizard.** One selection fills four
  others (AU → AUD, 10%, "GST", `Australia/Sydney`). Show them filled, editable, and say so
  — auto-fill that hides itself reads as a bug.
- **Screen 2 previews the actual document.** Brand settings are abstract until you see the
  quote header. The PDF pipeline is deterministic and layout is fixed per doc type
  (`document-layouts.ts`), so an HTML mock of the header block is honest and cheap.
- **Screen 3 is the "boring but load-bearing" screen** and the most likely skip. That is
  fine — every field has a working default (quote validity 30, payment terms 14, numbering
  off = manual entry). The one genuinely load-bearing item is **the first location**,
  because a serialized asset needs one; if skipped, the tour creates a default
  "Main warehouse" and says so.
- **Progress is derived, dismissal is stored.** Per D5, nothing tracks "step 3 done" —
  it is computed from the settings blob (has `currency`? has `branding.logoUrl`? has ≥1
  `Location`? has ≥2 members?). The only persisted bit is `setupDismissedAt`, per-user.
  A derived checklist cannot go stale against reality; a stored one can.

### 6.2 Logo variants — resolved: two is correct, no dark variant needed

**Decision (2026-08-01): keep `branding.logoUrl` (wide) + `branding.iconUrl` (square).
No dark-surface variants.**

Verified against the consumers rather than assumed. `branding.logoUrl` / `iconUrl` are read
by **only** the PDF pipeline (`src/lib/pdfme/build-document-data.ts`, the ten
`src/lib/pdfme/templates/tt-*.ts` report templates, and the test-tag report route) plus the
settings editor that writes them. Every one of those renders onto **white paper**, so there
is exactly one background to design for and a second variant would never be shown.

The dark-surface marks in the app — sidebar, login, favicon — come from a *different*
field: `SiteSettings.platformLogo`, platform-level and set by site admins
(`src/lib/site-settings-read.ts`, `dynamic-favicon.tsx`). That is not org branding and is
correctly out of scope for org onboarding.

Worth keeping the boundary crisp in the wizard's copy, since "logo" means two different
things in this codebase: screen 2 is uploading **the logo that prints on your documents**.

**Effort: M.**

---

## 7. Phase D — The activation tour

### 7.1 Milestones (derived, never stored)

| # | Milestone | Derivation |
|---|---|---|
| 1 | First model | org has ≥1 `Model` |
| 2 | First asset | that model has ≥1 `Asset` / `BulkAsset` |
| 3 | First project | org has ≥1 `Project` where `isTemplate: false` |
| 4 | Model on project | that project has ≥1 line item referencing a model |

Org-level counts are already cheap — `@convex-dev/sharded-counter` is a dependency and
dashboard counters already exist (`convex:backfill:dashboard-counters`).

Deriving rather than storing is what makes the tour **deviation-tolerant**: a user who
ignores the coaching and adds five models by hand simply finds the checklist already
ticked. No "tour state" to desync, no resume bugs, and no cleanup if they bail.

### 7.2 Surfaces

1. **A "Get started" card on the dashboard** — 4 milestones, ticks, a "5 min" honesty
   label, and a permanent dismiss. It disappears for good once all four are done.
2. **The helper rail** on `/assets/models/new`, `/assets/registry/new`, `/projects/new`,
   and the project equipment tab. When a milestone is pending, the rail carries the
   coaching copy instead of its usual hints. In-flow, no overlay (§2.5).
3. **Chained hand-offs.** After creating a model, the destination offers "Now add an asset
   to it" with the model prefilled. After the asset → "Create your first project". After
   the project → "Add *&lt;model&gt;* to it", deep-linked to the equipment tab with the model
   preselected. The chain is a *suggestion*, never a redirect.

### 7.3 Anti-rot

TODOS.md correctly flags that tour content must be maintained as the UI evolves. Two
concrete mitigations:

- **Milestones are data-derived, so they never break when the UI moves.** Only the
  coach-mark anchors are UI-coupled — keep them few.
- **Anchor them by `data-tour-anchor` attributes with a unit test** asserting every anchor
  named in the tour config exists in the source tree. A moved anchor becomes a red test,
  not a silently dead tour.

### 7.4 Copy

DESIGN.md sanctions personality **only** in empty states and annotation moments (Kalam is
scoped to exactly that), and **forbids** it in alert/compliance/overdue/conflict contexts.
The tour lives in the sanctioned zone. Rules: sentence case, never uppercase, no mascots,
no "Manage your X directory" SaaS filler, dry and specific — *"Models are the thing you
rent. Assets are the physical units of it."*

**Effort: M.**

---

## 8. Instrumentation

Extend `AnalyticsEvent` in `src/lib/analytics.ts` (the single source of truth for event
names — never inline a string):

```
onboarding_fork_chosen      { choice: "create" | "join_invite" | "join_domain" }
setup_step_viewed           { step }
setup_step_completed        { step }
setup_step_skipped          { step }
setup_completed             { steps_completed, steps_skipped }
activation_milestone        { milestone: "model" | "asset" | "project" | "line_item" }
activation_checklist_dismissed { milestones_done }
```

**R-8.12.4 applies without exception**: no org names, no emails, no addresses in
properties. Enum-ish strings and counts only. The provider is already PII-hardened
(no autocapture, cuid-only props) — see `docs/pii-inventory.md`.

The resulting PostHog funnel — signup → fork → org created → setup complete → 4 milestones
— is the first real measurement of time-to-value this product has had. Recommend
registering an **activation budget** in the README budget registry (R-0.4) once a baseline
exists; setting a target before measuring would be invented.

---

## 9. Testing

| Layer | Coverage |
|---|---|
| **Cross-tenant (Phase A gate)** | Two-org adversarial fixture over the full API registry — §4.5. **Blocking.** |
| Unit | Country → currency/tax/timezone defaulting; milestone derivation; setup-progress derivation. |
| jsdom smoke | Every new overlay/dialog actually **rendered** — CLAUDE.md's `TooltipProvider` crash passes typecheck, lint and build, and only fails when a user opens it. |
| Anchor integrity | Every `data-tour-anchor` in the tour config exists in source (§7.3). |
| E2E (Playwright) | Full path: register → fork → create org → wizard → 4 milestones. Plus the join path, and a "skip everything" path proving the app is usable with only an org name. |

---

## 10. Sequencing and effort

**Decision (2026-08-01): Phase A ships and soaks on its own, before any onboarding UI is
written.**

| Phase | Scope | Effort (human) | Gate to proceed |
|---|---|---|---|
| **A.0** | `definePayload` spike (§4.1) | 1 day | Must resolve to option 1 or 2 |
| **A** | Multi-tenancy + cross-tenant audit + WooCommerce tokens (§4.4) + org-delete cascade (§5.4) | **L (3–4 wks)** | Two-org adversarial suite green **+ soak, see below** |
| **B** | Signup fork, join paths, org-creation gate (§5.3), abandonment guards (§5.4) | S (< 1 wk) | — |
| **C** | Setup wizard | M (1–2 wks) | — |
| **D** | Activation tour | M (1–2 wks) | — |

### 10.1 Why A soaks alone

Phase A is invisible to users and carries essentially all of the program's security risk.
Shipping it behind no new UI means the only organisations on the instance are ours, so a
cross-tenant leak surfaces against our own data instead of a customer's.

Concretely, "soak" means: land Phase A, stand up a **second real organisation** on
production, and run both for a period with the adversarial suite in CI. That second org is
what converts every §2.3 guard from unfalsifiable to tested *in production conditions* —
the suite proves the code paths reject, the soak proves nothing in the live system depends
on them not rejecting.

Two consequences worth planning for:

- **A ships with `allowOrgCreation` off.** The multi-tenant machinery is live; the door
  stays shut until B adds the gated fork (§5.3). That is the cleanest possible staging —
  full capability, zero exposure.
- **The org switcher is the only user-visible artifact of A**, and only for accounts in
  ≥2 orgs, which during the soak is just us.

Per `docs/ROADMAP.md`, each phase is its own `/autoplan` run — one feature, one plan, one
review pipeline. Do not batch.

---

## 11. Open questions

### Resolved 2026-08-01

| Q | Answer | Recorded |
|---|---|---|
| Logo variants? | No — two is correct, org logos are PDF-only | §6.2, D8 |
| Ship Phase A alone first? | Yes, with a production soak on a second real org | §10.1, D7 |
| Who may create an org? | Site-admin toggle + signup code, from `/admin/settings` | §5.3, D6 |
| WooCommerce tenancy? | Fix it — opaque per-org webhook token, in Phase A | §4.4, D9 |
| Trials / billing? | Out of scope, revisit after this program | D11 |
| Org abandonment? | Guarded, not automated; deletion stays admin-initiated | §5.4, D10 |

### Still open

1. **Dormancy threshold `N`** (§5.4) — 14 days? 30? Only affects when an org appears on the
   admin's dormant list, so it is safe to pick 30 and tune. Not blocking.
2. **Does org deletion cascade into Convex, or archive?** §5.4 establishes that
   `adminDeleteOrganization` must stop orphaning Convex data. Hard-delete every org-scoped
   doc, or flip the org to an archived state and sweep later? Archive is safer and keeps
   the export meaningful; hard delete is what a customer asking to be forgotten expects
   (R-8.12). **Needs a decision during Phase A.**

---

## 12. Docs to update when this ships (R-5.2 / R-5.3 / R-5.8)

- `FEATUREDOCS/04-auth-permissions.md` — rewrite; single-org mode is gone.
- `FEATUREDOCS/69-onboarding-activation.md` — new; add to the `ARCHITECTURE.md` table.
- `FEATUREDOCS/27-settings-admin.md` — wizard as an alternate entry to the same settings;
  document the `/admin/settings` org-creation toggle + signup code (§5.3).
- `FEATUREDOCS/35-woocommerce-integration.md` — tokenised per-org webhook URL (§4.4).
- `CLAUDE.md` — the `by_cuid`/`requireOrgRead` note becomes live rather than latent.
- `TODOS.md` — retire the "In-App Onboarding Tour" entry.
- `docs/ROADMAP.md` — add the phases.
