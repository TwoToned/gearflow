/**
 * Crew-time planner settings (work-layer Phase 4, #1246) — the org-level
 * knobs for the crew planner's confirmation layer. Both live under
 * `OrgSettings.crewTime` (the `orgSettings` Convex JSON blob), validated here
 * (`crewTimeSettingsSchema`, `src/lib/validations/org-settings.ts`) and
 * mirrored server-side by `convex/lib/orgSettings.ts`'s
 * `resolveCrewOfferStaleHours` / `resolveCrewCallReminderEnabled` — that file
 * can't import from `src/lib` (Convex bundles separately), so the bounds are
 * duplicated there rather than imported, same posture as
 * `quote-validity.ts` / `convex/lib/quoteDates.ts`.
 *
 * Both settings are read SERVER-SIDE, in the org's stored timezone where a
 * date boundary is involved — never the browser's clock (POLICY.md R-9.3).
 */

/** Hours an OFFERED crew assignment can sit unanswered before it surfaces as
 *  a Triage "unanswered offer" signal for the project's PM to re-offer or
 *  find cover (design doc §8.5/§9 — "> 48h (org setting)"). Distinct from the
 *  fixed 24h crew-facing email nudge (`crew-time-nudges.ts`), which reminds
 *  the CREW MEMBER to respond rather than surfacing to the PM. */
export const DEFAULT_UNANSWERED_OFFER_HOURS = 48;
// The Zod schema (`crewTimeSettingsSchema`) enforces these bounds at SAVE
// time, so an out-of-range value can never be persisted — unlike
// `quote-validity.ts`'s `resolveQuoteValidityDays`, no separate read-side
// clamp is needed. Kept here (not inlined into the schema) so the schema and
// the settings UI's `<Input min/max>` share the one definition.
export const UNANSWERED_OFFER_HOURS_BOUNDS = { min: 1, max: 24 * 14 } as const; // 1h .. 2 weeks
