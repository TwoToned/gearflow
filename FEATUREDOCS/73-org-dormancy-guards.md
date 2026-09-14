# Org Dormancy Guards

> Part of the multi-tenant/onboarding program (tracking #1063), B4 (#1096) — abandonment guards.

A "never activated" org — signed up, never did anything — is dead weight: an owner row nobody
checks, an entry in every admin list, a slug held hostage. B4 closes the loop the activation
checklist (72) opens: orgs that ignore every prompt for 30 days get emailed, then archived, with a
self-service way back in.

## The predicate stays derived — only the side effect is stored

`isStillNeverActivated(memberCount, stats)` (`src/lib/org-dormancy-stages.ts`) is re-checked fresh
on every sweep tick, never cached: `memberCount === 1 && !hasAnyMilestone && lastActivityAt ===
null`. The moment a second member joins, an activation milestone (72) is hit, or any activity-log
row exists, the predicate flips to `false` on the very next tick — there's no explicit "cancel,"
the ladder just stops advancing and whatever stage it was on becomes irrelevant. `hasAnyMilestone`/
`lastActivityAt` come from `convex/orgAdminStats.ts`'s `getBatchOrgStats` (already built for
`/admin/organizations`), batched across every candidate org in one call — never N+1.

What genuinely can't be derived, and so is the one thing this feature stores, is "did we already
send this stage's email" — `organization.dormancyStage` / `dormancyNoticedAt`. Without that marker
the daily sweep would re-send the same stage every day it runs.

## The ladder

`nextDormancyStage(currentStage, daysSinceCreation)` (`src/lib/org-dormancy-stages.ts`) checks six
thresholds HIGHEST-first and returns the first one that's both later than the org's current stage
and old enough — so a tick missed to a deploy/outage catches up to the single most-advanced due
stage in one email, never replays every skipped one:

| Day | Stage | Action |
|---|---|---|
| 1 | `STAGE_DAY1` | nudge email |
| 3 | `STAGE_DAY3` | nudge email |
| 7 | `STAGE_DAY7` | nudge email |
| 23 | `STAGE_DAY23_WARNING` | "we'll archive in 7 days" |
| 29 | `STAGE_DAY29_FINAL_WARNING` | "archiving tomorrow" |
| 30 | `STAGE_DAY30_ARCHIVED` | archived + reactivation link |

Both functions are plain, pure, and live in `src/lib/org-dormancy-stages.ts` rather than in the
`"use server"` sweep module itself — a `"use server"` file's every export must be async
(Next.js's server-action transform), so the pure predicate/stage logic (and its stage constants)
had to move out to stay unit-testable without any Prisma/Convex/email mocking at all
(`org-dormancy-stages.test.ts`).

## The sweep

`runOrgDormancySweep()` (`src/server/org-dormancy.ts`) — one Postgres query (bounded
`MAX_ORGS_PER_TICK = 500`, oldest-created first, same backlog-drains-over-days discipline as
`convex/apiRequestLog.ts`'s `purgeOlderThan`) plus one batched Convex stats call, then per
candidate: re-check the predicate, compute the due stage, send the ladder email or archive.

Reached the same way every other Postgres-dependent cron in this repo is (see CLAUDE.md's
"HTTP-hop cron pattern"): `convex/crons.ts` registers `org-dormancy-sweep` (21:00 UTC, clear of the
22:00/23:00 slots the other two daily HTTP-hop crons use) → `convex/scheduledJobs.ts`'s
`runOrgDormancySweep` internalAction → `POST /api/cron/org-dormancy`
(`src/app/api/cron/org-dormancy/route.ts`, `CRON_SECRET`-bearer-gated, same shape as
`test-tag-reminders/route.ts`) → `runOrgDormancySweep()`. Dormant behind `ENABLE_CONVEX_CRONS`
like every other Convex-native cron in this file.

Archiving reuses the exact slug-release move `adminArchiveOrganization` (site-admin.ts) makes
(`${slug}-archived-${cuid}`, never auto-restored) but can't call that action directly — it's
`requireSiteAdmin()`-gated (session-based), and a cron has no session — so
`archiveDormantOrg()` reimplements the minimal archive write itself, attributed to
`userId: "system"` / `userName: "Dormancy sweep"` in the activity log (the same automated-actor
convention `wooCommerceActions.ts` already uses for `userName: "WooCommerce"`).

## Reactivation — single-use token, no session required

Archiving mints `dormancyReactivationToken` (`crypto.randomBytes(24).toString("hex")`, same style
as `org-creation-gate.ts`'s signup code) and emails a link to `/reactivate/<token>`. The page
(`src/app/(auth)/reactivate/[token]/page.tsx`) mirrors `(auth)/invite/[id]/page.tsx`'s shape — load
→ explicit confirm button → server action — rather than reactivating on a bare GET, since a link
scanner/prefetcher hitting the URL must not silently undo the archive.

`reactivateOrganizationByToken()` (`src/server/org-dormancy.ts`) is deliberately public: the whole
point is recovering access to an org whose only member may currently be locked out of everything.
It only ever matches an org that is CURRENTLY archived (a stale or already-used token fails
closed), clears `archivedAt`/`dormancyStage`/`dormancyNoticedAt`/the token itself in one update
(single-use), and — matching `adminUnarchiveOrganization`'s own choice — does NOT restore the
pre-archive slug, since another org may have claimed it in the meantime.

## Preventing the refill — verified email required to create an org

Emailing and archiving a dormant org is half the fix; the other half is making the throwaway-org
path itself harder. `allowUserToCreateOrganization` (`src/lib/auth.ts`) now requires
`user.emailVerified` before permitting org creation, checked AFTER the one-time bootstrap branch
(`isOrgCreationBootstrap()`) — the platform's very first user can't be locked out before they've
verified anything — and independently of the existing `allowOrgCreation` site-admin toggle /
signup-code gate (#1095), which still apply on top.

## Email copy

Four new templates in `src/lib/email-templates.ts` (`dormancyNudgeEmail`,
`dormancyArchiveWarningEmail`, `dormancyFinalWarningEmail`, `dormancyArchivedEmail`), composed from
the same `email-layout.ts` chrome (`emailShell`/`emailButton`/`emailMutedNote`/`escapeHtml`) every
other transactional email in this codebase uses. The archived-org email is deliberately
reassuring, not alarming — archiving is reversible and nothing is deleted, so the copy says so
("This isn't permanent — everything is still there, and one click brings it straight back.").
