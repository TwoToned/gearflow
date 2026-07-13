/**
 * Strip the keys a client must NEVER be able to change on a doc via a `set: v.any()`
 * (or `patch: v.any()`) browser-direct patch/replace — the tenant anchor
 * (`organizationId`) and the immutable cuid (`id`), plus any per-entity immutable
 * fields (e.g. a line item's `projectId`).
 *
 * Without this, a `set: v.any()` on a user-callable `*Writes` mutation lets a member
 * of org A reassign a row into org B (`set:{organizationId:"B"}`) — the up-front
 * `doc.organizationId === orgId` re-check passes (the doc is still in A) and then the
 * raw patch overwrites the field. Phase-3 security baseline: strict field validation
 * so clients can't smuggle data. Use this at every raw-apply site that has no explicit
 * field validator.
 */
export function sanitizeClientSet(
  set: unknown,
  extraImmutable: readonly string[] = [],
): Record<string, unknown> {
  const out = { ...(set as Record<string, unknown> | null | undefined) } as Record<string, unknown>;
  delete out.organizationId;
  delete out.id;
  for (const k of extraImmutable) delete out[k];
  return out;
}
