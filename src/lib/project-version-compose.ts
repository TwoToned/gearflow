/**
 * Project Versioning v2, Phase 5 (#1231, parent #1221, design §5 D32) — the
 * "composed object" client-side overlay.
 *
 * ~16 non-test `src/` files (including `getProjectWindow`,
 * `src/lib/project-window.ts`) read `project.rentalStartDate` /
 * `project.discountPercent` / etc. directly to render whatever version is on
 * screen. Phase 0's spike proved this works with ZERO edits to those
 * consumers as long as they're handed an object shaped like `projects.*` —
 * so instead of teaching every consumer about `projectVersions`, this module
 * takes a live project doc and a non-live version's PLAN FIELDS
 * (`convex/versionsRead.ts`'s `getVersion`, mirroring `convex/lib/
 * versionPlanFields.ts`'s `PLAN_FIELDS`) and returns a shallow-merged object
 * every existing component keeps reading unmodified.
 *
 * Only the PLAN FIELDS themselves are overlaid — id/status/isTemplate/
 * projectNumber/name, resolved relations (client/location/managers/media)
 * and every MONEY/derived field (subtotal/total/taxAmount/margin) stay the
 * LIVE project's own, exactly as `convex/lib/versionPlanFields.ts` documents
 * for why those are excluded from a version's plan snapshot in the first
 * place. A resolved relation (e.g. the client's NAME) can therefore lag a
 * non-live version's own `clientId` when that version was created under a
 * different client — a known, documented gap (not silently swept under the
 * rug): fully resolving version-scoped relations is follow-up work, not this
 * phase's scope.
 */
export function composeProjectWithVersion<T extends Record<string, unknown>>(
  project: T,
  viewingPlanFields: Record<string, unknown> | null | undefined,
): T {
  if (!viewingPlanFields) return project;
  // `pickPlanFields` (convex/lib/versionPlanFields.ts) always includes every
  // key, even as an explicit `undefined` when the source doesn't have it —
  // that's what makes a straight spread here the CORRECT "clear a field the
  // live project has but this version doesn't" behaviour, not a bug.
  return { ...project, ...viewingPlanFields };
}
