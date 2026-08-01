# Onboarding & activation — signup, org setup, first-run tour

> _Owner: Jayden Nawotka · Last reviewed: 2026-08-01 (review quarterly — POLICY.md R-5.5)_

**Created:** 2026-08-01
**Status:** Design — not started. No code written.
**Binding constraints:** [`POLICY.md`](../../POLICY.md) (profile `WEB`), [`DESIGN.md`](../../DESIGN.md).
**Supersedes:** the "In-App Onboarding Tour" P3 entry in [`TODOS.md`](../../TODOS.md) (which
scoped this as "~3–4 days, no schema or server work beyond a tour-completed flag" — that
estimate assumed single-org and is wrong, see §2).
**Mockup:** [`mockups/onboarding-mockup.html`](./mockups/onboarding-mockup.html) — eight
annotated screens built against the live RVLT tokens (open in a browser).
**Platform sweep:** [`multi-tenant-and-international.md`](./multi-tenant-and-international.md)
— the multi-tenant + internationalisation gaps this program sits on top of.
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

> **Corrected 2026-08-01** (see [`multi-tenant-and-international.md`](./multi-tenant-and-international.md) §2.1):
> "unfalsifiable" is too strong. `convexTest` can hold two orgs even though production holds
> one, and **`convex/xtenantHardening.test.ts` already exists** — 198 lines of exactly this
> adversarial fixture, covering session identity, agent tokens, the #1001 unguarded reads and
> create-time dup-guards. The guards are unfalsifiable **in production**, and today only
> *representatively* tested — the file says so itself. The work in §4.5 is therefore
> **extending a proven harness to exhaustive coverage**, not building one. Same effort,
> materially less risk.

### 2.4 Other single-org assumptions found

| Issue | Where | Severity when multi-tenant |
|---|---|---|
| `adminDeleteOrganization` is a bare `prisma.organization.delete` — it never touches Convex, where all domain data now lives, so calling it **orphans the entire dataset** | `src/server/site-admin.ts:246` | **High** — orphaned docs keep their `organizationId` and stay reachable by any global-index read that skips its org check (§2.3). **Resolved by D12: the action is removed, not fixed** (§5.4) |
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
| **D12** | **Orgs are archived, never deleted** (§5.4). `archivedAt` enforced at the three identity chokepoints; `adminDeleteOrganization` is removed rather than fixed. | User decision, 2026-08-01. Reversible, and it turns a Convex-orphaning defect into deleted code. |
| **D13** | **Dormancy threshold is 30 days**, with a warn-at-23 / final-at-29 / archive-at-30 email ladder, **automated** (§5.4). Amends D10. | User decision, 2026-08-01. Automation is licensed by D12's reversibility, not by the warnings alone. |
| **D14** | **Org switcher in the user panel** (`user-nav.tsx`), with a mandatory Convex token re-mint on switch (§4.3.1). | User decision, 2026-08-01. Multi-org is unusable without it, and the naive implementation causes cross-tenant reads. |

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

- **Org switcher** in the user panel — see §4.3.1, it has a sharp edge.
- **`addMemberByEmail` becomes invite-only.** Adding an existing user directly is removed;
  every membership requires the recipient to accept.
- **Per-org join policy** (`INVITE_ONLY` | `DOMAIN_REQUEST` | `CLOSED`) in org settings,
  distinct from the platform-global registration policy.
- **WooCommerce webhook tenancy** — opaque per-org token (§4.4).
- **Org archiving** (§5.4) — `archivedAt` + the three chokepoint guards; remove
  `adminDeleteOrganization`.
- **Site admin** — real org list, per-org drill-down, dormant filter (§5.4).

### 4.3.1 The org switcher (D14)

Goes in the existing user panel — `src/components/layout/user-nav.tsx`, the sidebar-footer
dropdown. It already has the right affordance: avatar, name, email, and a `ChevronsUpDown`
chevron, which is the conventional switcher glyph. The menu simply has nothing to switch yet.

#### Anatomy

Add an **Organisations** group at the top of the existing `DropdownMenuContent`: one item
per non-archived membership, a check against the active one, and the user's role as
secondary text. Below it, the existing account / crew / admin / sign-out groups, unchanged.

- It is a **Radix** `DropdownMenu`, so triggers compose with **`asChild`**, never `render`
  (CLAUDE.md). The file already follows the repo's `DropdownMenuLabel`-inside-
  `DropdownMenuGroup` convention — keep it.
- **Show the group only when the user has ≥2 memberships.** One-org users get no clutter.
- **Put the active org name in the trigger** regardless, as the second line. Today that
  line is the user's email, which is already duplicated in the menu header two rows below —
  so this removes a duplication and adds the missing context rather than growing the panel.
- **Archived orgs never appear** (D12).
- Needs a `getMyOrganizations()` read returning the caller's non-archived memberships. It
  must be membership-derived, never a list of all orgs filtered client-side.

#### The sharp edge: switching org must re-mint the Convex token

`organization.setActive()` updates the Better Auth session — but **the Convex JWT carries
`orgId` as a claim** (§4.2 A2), and the browser's Convex client keeps using the token it
already holds. Without an explicit re-mint, every live Convex subscription keeps serving the
**previous org's data** until the token happens to expire. That is a cross-tenant read
produced by the switcher itself, and it would look exactly like a caching bug.

The switch is therefore a sequence, not a call:

1. `organization.setActive({ organizationId })`
2. Force a fresh token mint (`/api/auth/token`)
3. Re-authenticate the Convex client so every subscription re-subscribes under the new claim
4. Drop client caches
5. **Navigate to `/dashboard`** — never stay put

Step 5 matters more than it looks. Staying on `/projects/<id>` after a switch carries an id
belonging to the *old* org into the new one. Best case a 404; worst case it is an IDOR probe
fired by our own UI at exactly the surface §4.5 exists to protect. Always land on a
tenant-neutral root.

Step 4 is mostly free: `useServerQuery` keys already include `orgId`
(`["my-crew-id", orgId, isAuthenticated]` in `user-nav.tsx` is the established pattern), so
correctly-keyed queries re-fetch on their own. Any key *missing* `orgId` is a bug the
switcher will expose — worth a sweep during Phase A.

#### `OrgActivator` must stop guessing

`src/components/providers/org-activator.tsx` currently heals a missing active org by calling
`getTheOrgId()`. With multiple orgs, guessing is unacceptable. It becomes: **1 membership** →
activate it; **≥2** → route to a picker; **0** → route to the fork (§5.1). Archived
memberships don't count toward any of those.

#### Testing

The switcher is the one piece of UI that can *cause* a cross-tenant read, so it gets an
explicit E2E: a user in two orgs switches, and the assertion is that the second org's
dashboard shows **none** of the first org's entities. Plus a jsdom smoke test that actually
**opens** the menu — a closed-trigger render proves nothing (CLAUDE.md, "Test menus by
actually OPENING them").

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

**Gate: the existing two-org fixture extended to registry-driven exhaustive coverage, green
before Phase B starts.**

`convex/xtenantHardening.test.ts` already seeds `org_A` / `org_B`, plants colliding-FK rows in
both, and asserts org A never sees org B's — for session *and* agent identities. It covers 8
representative cases against a surface of **72 `listBy*` queries** and ~1,500 `by_cuid` reads.

Extend it, driven by `src/lib/api/registry.generated.ts` (which already enumerates every
agent-reachable operation), so **every** operation is invoked with Org A's identity against
Org B's entity ids and asserted to reject. `convex/agentServiceUnreachable.test.ts` proves the
registry-driven shape scales across 602 functions.

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

#### Detection — "never activated", derived, at 30 days

Same principle as D5 and §7.1. An org qualifies when **all** of:

- exactly 1 member, and
- **zero activation milestones — no models, no assets, no projects, ever**, and
- no activity-log entries since creation, and
- created more than **30 days** ago (D13).

Every one is already queryable: the activity log exists (FEATUREDOCS/24) and the milestone
counts exist (§7.1). No new column, no flag to maintain, nothing to drift.

> **The predicate is "never activated", not "currently inactive" — and that distinction is
> what makes automating this safe.** A seasonal rental company that set up properly in
> March and goes quiet over winter has models, assets and projects, so it can **never**
> match, no matter how long it idles. The only orgs that qualify are ones that did
> genuinely nothing from the day they were created. Anything else is a bug in the
> predicate, not a judgement call about the customer.

#### The email ladder

Resend is already wired (`RESEND_API_KEY`, `EMAIL_FROM`), and `email-templates.ts` /
`email-layout.ts` are the existing composition helpers. All of these go to the owner:

| Day | Email | Tone |
|---|---|---|
| 1, 3, 7 | **Activation nudge** — "You're two steps from your first quote", deep-linked to the resumable setup checklist (D3 makes that link land somewhere useful) | Encouraging |
| **23** | **Archive warning** — "We'll archive *&lt;Org&gt;* in 7 days. Add anything at all and we won't." | Plain, no alarm |
| **29** | **Final warning** — 24 hours' notice | Plain |
| **30** | **Archived** — confirms it happened, with a one-click reactivation link | Reassuring, not final |

**Any qualifying activity cancels the ladder permanently.** Because the predicate is
"never activated", creating a single model exits it forever — there is no re-entry.

Two rules the copy must follow: the day-30 email is **not** a goodbye (archive is
reversible, and saying otherwise would be untrue), and the ladder never exceeds these five
sends. An onboarding sequence that keeps nagging is worse than an abandoned org.

#### Automation — permitted here, because archive is reversible

D10 said "guarded, not automated". That was about *deletion*. Under D12 the terminal action
is a reversible archive, preceded by two warnings and followed by one-click reactivation,
so **auto-archiving at day 30 is safe** and D10 is amended accordingly (D13). Nothing
irreversible is ever automated.

#### Implementation

A `crons.daily("org-dormancy-sweep", …)` job in `convex/crons.ts`, following the
conventions already established there:

- **Gated behind `ENABLE_CONVEX_CRONS`** — the off-by-default rollout discipline every job
  in that file uses.
- **Bounded per tick**, the way `apiRequestLog.purgeOlderThan` caps at 2000 rows: a backlog
  drains over extra days rather than blowing one mutation's read/time limits.
- Native Convex `internalMutation` where possible; the emails need the Next.js side, so
  those follow the HTTP-hop pattern the other jobs use.

**Store the sends, derive the state.** The dormancy *predicate* stays derived — but "did we
already email them?" cannot be derived from anything, and without a marker the cron re-sends
daily. A `dormancyNoticedAt` timestamp on the org is therefore legitimate storage: it
records an **outbound side effect**, not a duplicate of business state. That is the line —
D5 forbids storing what you can compute, not recording what you did.

Deriving from `createdAt` alone (fire when age is exactly 23 days) would avoid the field but
silently skips a warning whenever a cron tick is missed to a deploy or outage. Not worth it
for a warning that precedes an automated action.

#### Surfacing

**A "Never activated" filter on `/admin/organizations`**, with age, owner contact, and
where each org sits in the ladder. Converts an invisible accumulation into a list a human
can act on — and lets an admin archive early or exempt an org before day 30.

#### Cleanup — archive, never delete (decided 2026-08-01)

**D12: organisations are archived, not deleted.** The flow is: admin sees the dormant list →
exports (the export button already exists on `/admin/organizations/[id]`) → archives behind
a typed confirmation. Reversible.

That decision also disarms a defect found while designing this path:

> **`adminDeleteOrganization` is Postgres-only.** `src/server/site-admin.ts:246` is a bare
> `prisma.organization.delete({ where: { id } })`. Since the Convex migration **Postgres
> holds only Better-Auth + audit models** (CLAUDE.md) — every model, asset, project, quote
> and file lives in Convex. Calling it removes the auth rows and **orphans the entire domain
> dataset in Convex**, unreachable and uncounted, while orphaned docs keep their
> `organizationId` and stay reachable by any global-index read that skips its org check
> (the §2.3 class).
>
> Under D12 the fix is to **remove the action**, not to build a cascade. It is currently
> unreferenced by any UI. Deleting the delete is strictly less code than making it correct.

##### Design

`Organization.archivedAt DateTime?`, mirrored to Convex `organizations.archivedAt`. This
deliberately copies the shape of the existing **`apiKillSwitchAt`** field on the same model
— an org-wide, timestamp-valued containment switch is already an established pattern here.

**Enforce at the identity chokepoints, not per-read.** Exactly the property that makes
§4.2's swap cheap: every org-scoped read in the app derives its `organizationId` from one
of three places, so three guards cover the whole surface.

| Chokepoint | Behaviour on an archived org |
|---|---|
| `requireOrganization()` (§4.2 A1) | Throws — the entire server-action surface closes at once |
| `definePayload` (§4.2 A2) | Refuses to mint `orgId` — every Convex read/write closes |
| **API-key / agent-token path** | Rejected. **This one is easy to miss**: the dispatcher mints agent tokens from `apiKeys`, *not* from a session, so it bypasses both guards above. Archiving must also trip `apiKillSwitchAt`, which already rejects all of an org's keys unconditionally. |

No per-query `archivedAt` filter anywhere. A read that could see an archived org's data
would need an `orgId` that none of the three paths will issue.

##### The rest of the surface

- **`organization.setActive()` must refuse** an archived org, and the switcher hides them.
  A user whose *only* org is archived logs in to an explanatory screen — not an empty
  dashboard, and not a crash.
- **Slug is released on archive**: rewrite to `<slug>-archived-<shortid>` in both Postgres
  (`slug @unique`) and Convex, freeing the original for reuse. This is the slug-reclamation
  item, folded in.
- **Unarchive exists** — that is the whole point of D12. It fails cleanly if the original
  slug has since been taken, prompting for a new one.
- **Outbound activity must stop**, or an archived org keeps emitting: iCal feeds
  (`icalEnabled`/`icalToken`), the WooCommerce webhook (returns the same opaque response as
  an unknown token — §4.4), Xero sync, and notification emails.
- **Storage is retained.** Archived orgs keep their Convex `_storage` files; the liability
  grows rather than being bounded. Acceptable at current scale, worth a size column on the
  admin list so it stays visible.

##### Erasure — resolved by M5

Archive defers erasure rather than providing it. With EU customers in scope
([`multi-tenant-and-international.md`](./multi-tenant-and-international.md) M1), that stopped
being a deferred gap: **M5 adds a separate, explicitly-invoked hard-delete path that does
cascade through Convex**, for a genuine right-to-erasure request (POLICY §8.12).

D12 is unchanged and still governs everything automatic — the dormancy ladder archives and
never destroys. Two operations with two different triggers, rather than weakening the
automatic one into something that can delete.

---

## 6. Phase C — The org setup wizard

Route `/setup`. Owner-only. Five screens, sectioned — not eight steps, which tests as a
slog. Every screen after the first has **"Skip for now"**.

| # | Screen | Contents | Blocking? |
|---|---|---|---|
| 0 | **Your company** | Name (+ auto-slug, editable). **Creates the org, sets active, mirrors membership.** | **Yes** |
| 1 | **Where you operate** | Country → *auto-fills* currency, tax rate, tax label, timezone, **and the business-number field's label** (see below). Email, phone, website, business number, address (Places autocomplete — `@vis.gl/react-google-maps` is already a dep). | No |
| 2 | **Your brand** | Logo, icon, primary/accent/document colour, `documentLogoMode`. **Live quote-header preview** beside the fields. | No |
| 3 | **How you work** | Project number format (live `peekNextProjectNumber` preview already exists), invoice number format, asset-tag prefix/digits; quote validity days, payment terms days, footer, T&Cs, payment details; **first location**. | No |
| 4 | **Your team** | Invites with a plain-English role explainer (owner/admin/manager/member/warehouse/viewer). | No |
| 5 | **Your gear** | **Import a CSV** (FEATUREDOCS/20) *or* **add your first item by hand** → hands off to Phase D. | No |

### 6.1 Design notes

- **Country is the highest-leverage field in the whole wizard.** One selection fills four
  others (AU → AUD, 10%, "GST", `Australia/Sydney`). Show them filled, editable, and say so
  — auto-fill that hides itself reads as a bug.
- **ABN is a country-derived *label*, not a fixed field.** It belongs in the same
  country-driven group: AU asks for an ABN, NZ an NZBN, the UK a company number. The
  storage is already generic — `OrgSettings.abn`'s own doc comment reads _"Australian
  Business Number (or local equivalent tax/business registration id)"_ — so this is a UI
  change, not a schema one. The label (and its format hint/validation) comes from the same
  country table that yields currency and tax label, which keeps it a single source of truth
  rather than a second hand-maintained mapping (R-3.1).
  **Do not** rename the stored field per country; only what the operator is asked for changes.
- Distinguish the two visually: the four *derived values* render as filled/dimmed, the
  business number renders as a normal empty input. The label is ours; the value is theirs.
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
| **A** | Multi-tenancy + cross-tenant audit + WooCommerce tokens (§4.4) + org archiving (§5.4) | **L (3–4 wks)** | Two-org adversarial suite green **+ soak, see below** |
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
| Org abandonment? | Guarded, not automated; admin-initiated | §5.4, D10 |
| Delete or archive? | Archive — reversible, and `adminDeleteOrganization` gets removed | §5.4, D12 |
| Dormancy threshold? | 30 days, with a warn/final/archive email ladder, automated | §5.4, D13 |
| Org switcher? | In the user panel, with a token re-mint on switch | §4.3.1, D14 |

### Still open

1. **Retention of archived orgs.** D12 keeps archived orgs (and their Convex `_storage`
   files) indefinitely. No action needed now — flagged so the storage line item is a known
   cost rather than a surprise.

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
