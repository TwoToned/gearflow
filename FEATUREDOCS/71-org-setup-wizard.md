# Org Setup Wizard

> Part of the multi-tenant/onboarding program (tracking #1063, Phase C: #1068). Design:
> [`docs/designs/onboarding-and-activation.md`](../docs/designs/onboarding-and-activation.md) §6.
> Mockup: [`docs/designs/mockups/onboarding-mockup.html`](../docs/designs/mockups/onboarding-mockup.html)
> screens 2-3.

`/setup` — one route hosting all five wizard steps as client-side state (`SetupPage` in
`src/app/(auth)/setup/page.tsx`), reached only from `/welcome`'s "Set up a new company" card
(B1, #1092). No per-step routing: `TOTAL_STEPS` lives in `wizard-steps.ts`, shared by every
step file, and `WizardRail` (`src/components/ui/wizard-rail.tsx`) is a generic flat 5-pip
progress bar taking `step`/`total`, with no routing opinion of its own.

## D3/D5 — only the name blocks, and there is no draft state

Step 1 (C1, #1098) is the **only blocking screen**. Naming the org commits it for real:
`organization.create()` → `setActive()` → `mirrorMyMembership()` (Convex membership mirror,
since the org plugin's own create path never does this) → `seedOrgDefaults()` (currency + tax
rate seeded once from the platform's `SiteSettings` defaults, and the org/SSO login-info cache
busted for the new slug). From here on, **every later screen is an ordinary settings write
against a live org** — the wizard writes through `updateOrganization`
(`src/server/settings.ts`), the SAME server action the general Settings page
(`src/app/(app)/settings/page.tsx`) uses. There is no parallel wizard-only write path and no
draft/progress state stored anywhere: skipping a screen just leaves those settings unset,
exactly as if the operator had never opened Settings either.

Step 1's own best-effort steps (`mirrorMyMembership`/`seedOrgDefaults`) are wrapped so a
transient failure never blocks the success redirect — the org already exists by that point, so
surfacing a blanket error would strand the user on a form whose retry then fails with "slug
already taken" against an org they already own.

## Step 2 — "where you operate" (C2, #1099)

Country is the highest-leverage field in the wizard: one pick auto-fills currency, timezone, tax
label and tax rate, plus what the business-number field is even CALLED (ABN/NZBN/VAT
number/EIN — `CountryDefinition.businessNumberLabel`, `src/lib/countries.ts`). Auto-filled
values render as ordinary editable inputs with a "filled" visual treatment (dimmed
border/background once populated) — never disabled, never hidden: "auto-fill that hides itself
reads as a bug." The business-number VALUE is always a plain input; only its LABEL is
country-derived (`OrgSettings.abn` is deliberately generic storage, per its own doc comment).

**Timezone is a representative default, not an authoritative mapping.** `CountryDefinition`
gained a `timezone` field for this screen (previously the country table had no timezone column
at all, despite the design doc/mockup assuming one) — one IANA zone per country. This is exact
for single-zone markets (NZ/GB/IE) and a starting guess for multi-zone ones (AU spans three
zones, two with DST; the US spans six) — the same "editable, and say so" posture already
governing the other three derived fields covers the imprecision; a Perth or Denver org corrects
it in one edit.

**Country is permanent once saved (M6).** The field says so at the point of choice. Enforcement
is entirely server-side — `withImmutableCountry()` in `src/server/settings.ts` follows the
`PROJECT_UPDATE_IMMUTABLE` pattern (`convex/projectWrites.ts:420`): a patch containing a
DIFFERENT `country` than what's already stored is silently overridden back to the existing
value, never merely blocked by a disabled input (R-9.3 — `settings` is a client-supplied blob,
so the server has to re-check regardless of what the UI sent). Only a still-unset country (the
org's first save) may actually set it. See `src/server/settings-country-immutable.test.ts`.

The wizard screen itself locks the `<Select>` (disabled) as soon as hydration finds a
country already persisted, so the normal path can't even attempt a doomed change — and on
save, checks `updateOrganization`'s returned (actually-persisted) settings against what was
submitted rather than assuming success from a non-throwing call, so a stale/duplicate-session
edge case (double tab, browser back/forward onto an already-configured org) surfaces a clear
"already set, can't be changed" error and re-locks the picker instead of reporting a false
"Saved."

Address collection uses `AddressInput` (`src/components/ui/address-input.tsx`) with
`countryCode` biasing — the same Google Places-backed component 5 other forms
(location/client/crew/supplier) already use, gained an optional `id` prop here so its sibling
`<Label htmlFor>` actually associates (none of the other consumers pass one, so this is
additive, not a behavior change for them).

### Known gap: Settings' own country field doesn't (yet) honor M6

`src/app/(app)/settings/page.tsx`'s country `<Select>` is still a plain editable, unannotated
dropdown — not read-only, no "permanent" note — even though the server already silently
discards any change to an already-set country. That mismatch (an edit that visually "works" but
is discarded on save) pre-dates this wizard and is out of scope for #1099; worth a follow-up
issue. Settings also still hand-maintains its own `COUNTRIES`/`TIMEZONES` label lists rather
than importing `src/lib/countries.ts` — a second country→label map the module's own docstring
warns against (R-3.1), not fixed here to keep this PR's diff scoped to the wizard.

## Steps 3-5 — not yet built

Screens for branding, numbering/document terms, team invites and gear import (#1101-#1104) are
still open. Until they land, step 2's "Skip for now" and "Save and continue" both end the
wizard by redirecting to `/dashboard` — consistent with D3: everything past the name is safe to
skip because it's a live org, not a draft.
