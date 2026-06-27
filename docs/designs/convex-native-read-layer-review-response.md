# Review Response — Convex-Native Read Layer Plan

Thanks for the plan. The overall direction looks right: reads-first is the correct sequencing, the existing Better Auth → Convex JWT bridge should be reused rather than rebuilt, and the plan correctly avoids exposing the current service-only Convex bundles directly to browser users.

That said, I would not treat this as implementation-ready yet. There are a few issues that need tightening before we hand this to an implementation agent.

## Summary Verdict

The architecture is solid, but the plan needs one more hardening pass around:

1. **RBAC mirror fail-closed semantics** — currently stated, but not actually designed enough to be safe.
2. **Complete membership/custom-role write-site coverage** — there are more auth-affecting Prisma writes than the plan lists.
3. **Convex query cache mechanics** — the plan needs to verify/use the actual `convex-helpers` cached hooks, not assume the provider alone changes normal `convex/react` `useQuery` behaviour.
4. **Dashboard counters** — this is a mini domain design, not a sub-bullet.
5. **Phase 4 deletion scope** — `use-shared-resource.ts` has broader Prisma/auth-adjacent usage than just project equipment.

## What Looks Good

- **Reads first, writes later** is the right sequencing. Moving writes, audit, and invariants into Convex first would carry much more data-integrity risk.
- The plan correctly identifies that the auth bridge is already mostly solved:
  - `convex/lib/auth.ts` already resolves service/user identities and has org-scoped read guards.
  - `src/components/providers/convex-provider.tsx` already wires `ConvexProviderWithAuth`.
  - `src/hooks/use-authed-query.ts` already avoids the “query before token attaches” browser crash class.
- The plan correctly refuses to expose `convex/projectEquipment.bundle` directly. That query is explicitly service-only and returns raw docs including `projectLineItemUnits`.
- The dashboard whole-org read risk is real. `src/server/dashboard.ts` does whole-org reads and JS aggregation across assets, bulk assets, projects, line items, maintenance, crew, and assignments.
- The viewer permission correction is accurate: `viewer` does have `project: ["read"]` in `src/lib/permissions.ts`.

## Required Changes Before Implementation

### 1. Define the RBAC Mirror Write Ordering Contract

The plan says membership/custom-role mirror writes must fail closed. I agree, but this needs a concrete ordering contract.

Because Prisma and Convex cannot participate in a single transaction, this pattern is unsafe for permission removals:

```ts
await prisma.member.delete(...);
await convex.mutation(api.membersMirror.delete, ...);
```

If the Convex write fails after the Prisma revoke succeeds, Postgres has removed access but Convex still grants native browser reads. That is fail-open.

Please add an explicit rule:

#### Permission-removing / restrictive changes

For revocation, demotion, custom-role permission removal, custom-role deletion, or ownership transfer demotion:

1. Apply the **more restrictive state to Convex first**.
2. Then commit the Prisma source-of-truth change.
3. If Prisma fails after Convex succeeds, reconcile later; temporary over-denial is safer than temporary over-grant.

#### Additive grants

For new members, promotions, or additive custom-role permissions:

1. Commit Prisma first.
2. Mirror to Convex after.
3. A short delay or retry is acceptable because stale Convex state denies too much, not too little.

#### Ownership transfer

`transferOwnership` needs an explicit strategy because it is both a demotion and a promotion:

- demote the old owner in Convex before Prisma demotion, or use a dedicated mirror mutation that applies the safe intermediate state;
- then apply the Prisma transaction;
- then apply/promote the new owner in Convex if not already mirrored.

The exact mechanics can vary, but the security property must be explicit: **a failed mirror operation must never leave Convex granting permissions that Prisma has revoked.**

### 2. Expand the Membership/Custom-Role Write-Site Audit

The plan lists some write sites, but the actual repo has more auth-affecting membership/custom-role writes.

Known write sites include at least:

| File | Examples |
|---|---|
| `src/server/org-members.ts` | `member.update`, `member.delete`, ownership transfer |
| `src/server/custom-roles.ts` | `customRole.create/update/delete`, duplicate role |
| `src/server/settings.ts` | member create/delete |
| `src/server/site-admin.ts` | org owner create, member create/delete/update |
| `src/server/user-profile.ts` | leave organization/member delete |
| `src/lib/auth.ts` | auto-create member on registration |
| `src/lib/sso-provisioning.ts` | SSO role sync/member create |
| `src/server/sso.ts` | SSO approval member create |

Please make Phase 1b include a mechanical audit gate, not just a prose reminder.

Suggested gate:

```bash
rg "prisma\.member\.(create|update|delete)|tx\.member\.(create|update|delete)|prisma\.customRole\.(create|update|delete)|tx\.customRole\.(create|update|delete)" src
```

Every hit must be either:

- routed through the mirror helper,
- explicitly annotated as non-auth-affecting, or
- covered by a separate migration path.

This should also have a test or lint-style script so future membership writes do not bypass the mirror accidentally.

### 3. Specify the Convex Query Cache API Precisely

The plan says to add `ConvexQueryCacheProvider`, but it needs to be more precise.

`convex-helpers` is not currently installed in `package.json`, and the provider alone may not make ordinary `convex/react` `useQuery` calls cached. Convex Helpers exposes cached replacement hooks via its cache package; the implementation should verify the import path and hook usage against TypeScript rather than guessing.

Please revise Phase 0 to say something like:

- install `convex-helpers`;
- verify the correct import path from the installed package, likely around `convex-helpers/react/cache`;
- wrap the app in `ConvexQueryCacheProvider` in the existing Convex provider tree;
- use the cached `useQuery` / `useQueries` hooks from Convex Helpers for migrated surfaces where keep-alive caching is required;
- preserve the auth gating behaviour from `useAuthedQuery` so queries remain skipped until `useConvexAuth().isAuthenticated` is true;
- configure a bounded TTL / entry count if the library supports it;
- do not assume one-shot `convexClient.query()` warms this cache.

Also, keep SSR `preloadQuery` out of the core migration unless there is a separate auth-reviewed design for minting a per-request user Convex JWT. The service token must not be used for SSR preload because it bypasses per-user read scoping.

### 4. Split Dashboard Counters Into Their Own Design Slice

The plan correctly flags dashboard `.collect()` risk, but “use counter tables” is underspecified.

`getDashboardStats()` currently derives counts from multiple domains:

- assets
- bulk assets
- projects
- maintenance records
- project line items
- crew members
- crew assignments

Counter tables are not just a query change; they introduce write-path obligations. Please make this its own mini-design before implementation:

- exact counter table schema;
- which writes update which counters;
- how project status/date changes update active/overdue counts;
- how asset/bulk quantity/status changes update utilization counts;
- how maintenance and crew writes update dashboard counts;
- backfill script;
- parity/reconcile script;
- tests proving counter values match the current JS-derived values.

Otherwise Phase 3 risks becoming a swamp.

### 5. Narrow the Phase 4 Deletion Claim

The plan says to delete `use-shared-resource.ts` once migrated, but current usage is broader than equipment.

It is used by things like:

- SSO settings/providers;
- group/service templates;
- custom roles;
- org members;
- organization/profile/platform name;
- project detail/services/crew/conflicts;
- project equipment.

Some of those are Prisma/auth-adjacent and may not become native Convex reads during Phases 0–4.

Please change Phase 4 to:

> Delete only dead detail/equipment-specific shared-resource consumers after grep proves they are unused. Keep `use-shared-resource.ts` until every remaining Prisma-backed shared-resource consumer has a replacement.

## Smaller Corrections

- `members` currently has `by_organizationId` and `by_userId`, but not `by_org_user`; the plan correctly adds it. Make that a schema migration requirement.
- `customRoles.permissions` is currently `v.string()` in Convex schema. If the plan wants a validated object in Convex, that is a schema change. Otherwise keep it as a string and parse/validate inside the guard.
- `permissions.ts` appears pure/import-free, so relocating it to an isomorphic module is low risk.
- Avoid mentioning `staff` in current role examples unless intentionally handling legacy data; the active assignable roles no longer include it.
- The dashboard page currently has 6 `useServerQuery` calls. `getDashboardStats` internally fans out to 7 reads. Keep those two counts distinct.

## Suggested Implementation Gate

Before Phase 1 UI cutover, I would require:

- [ ] `requireOrgPermission` implemented with parity tests against `requirePermission` / `hasPermission`.
- [ ] `members.by_org_user` index added.
- [ ] all membership/custom-role write sites audited with grep and mirrored/annotated.
- [ ] restrictive mirror-write ordering documented and tested.
- [ ] custom-role permission update/removal test proves active browser subscriptions stop authorizing immediately.
- [ ] browser DTO bundle tests prove service-only/raw fields are absent.
- [ ] Convex Helpers cache usage compiles and uses the actual cached hook API.
- [ ] equipment native-read path remains behind a data-source flag for rollback.

## Bottom Line

I’m aligned with the plan’s direction. Reads-first native Convex subscriptions are the right move, and the project already has enough of the auth bridge and Convex write path in place to make this feasible.

The main thing to fix before implementation is the RBAC mirror design. If that is vague, this migration can accidentally create a stale-permission read leak: revoked or demoted users retaining native Convex read access until a reconcile job catches up.

Tighten the mirror semantics, make the write-site audit mechanical, verify the Convex Helpers cache API, and split dashboard counters into their own scoped design. After that, I’d be comfortable using this as the implementation brief.
