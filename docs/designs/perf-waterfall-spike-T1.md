# Spike (T1): replace vs optimize the version-vector → server-action waterfall

**Status:** spike findings (approved at the autoplan final gate). Time-box ~1 day of
investigation; this is the writeup + recommendation, no production code.

## The waterfall (what we're deciding about)
Detail surfaces don't use pure Convex `useQuery` subscriptions. They use
`useReactiveServerQuery` (`src/hooks/use-reactive-server-query.ts`):
1. subscribe to a cheap Convex `version` query (a "version vector"),
2. when it ticks, re-run a **server action** (`getKit`/`getAsset`/`getProjectForWarehouse`/
   `getProjects`) that re-reads a full composite over HTTP.

So every relevant write = `Convex push → detect version change → second server roundtrip →
full Prisma+Convex composite re-read`. It exists because the composites join **Better Auth
users** (Prisma), which Convex can't hold — so a pure `useQuery` is infeasible *today*.

This is upstream of findings #2 (the composites are full org reads) and #3 (the double
refetch). Both review voices (CEO + Eng) independently flagged it as the possible real root
cause, not just a thing to optimize around. Hence this spike.

## Measured surface (this repo, verified)
- **`useReactiveServerQuery` call sites:** 8, across 4 surfaces — `kits/[id]`,
  `assets/registry/[id]`, `warehouse`, `warehouse/[projectId]` (plus `use-project-detail`
  uses the same shape).
- **Version queries:** 3 — `convex/kitDetail.ts`, `assetDetail.ts`, `warehouseDetail.ts`.
  **All pure Convex** (no Prisma/user reads) — so the *trigger* half is already clean.
- **The blocker — `prisma.user.*` joins in server composites:** ~**48 join sites across ~20
  `src/server/*.ts` files**. This is the cross-domain surface that prevents the composites
  from being pure Convex queries.

## Option A — Optimize around (status quo, what #2/#3 do)
Keep `useReactiveServerQuery`; make each composite cheap by scoping its reads (the #2
pattern) and dropping the double refetch (#3).
- **Cost:** ~1 small PR per detail surface. Already done for `getKit` (#279) and `getAsset`
  (#280) at low risk, parity-by-construction.
- **Keeps:** the server roundtrip per tick, the double-fetch tendency, and N future
  composites each needing their own scoping pass. The architecture (and its latency floor:
  Convex push → detect → HTTP server action → compose) stays.
- **Risk:** low, incremental, proven.

## Option B — Replace (mirror Better Auth users into Convex)
Mirror the `user` table into Convex (id, name, email, image — already app-exposed, low
sensitivity; Better Auth stays the source of truth, Convex `users` is a read-mirror written
on user create/update, exactly like the ~43 tables already mirrored). Then the composites
that only joined Prisma for `user` become **pure Convex queries**, and detail pages become
pure `useQuery` subscriptions: the version vector + server action + double refetch all
**delete**, replaced by incremental Convex reactivity (only the changed rows re-push).
- **Cost (sized):** (1) a `users` Convex table + mirror write path (1 table, ~1 PR — the
  mirror infra already exists and is well-trodden); (2) migrate the ~48 `prisma.user` join
  sites to read the Convex mirror (mechanical, but ~20 files — several PRs); (3) convert the
  4 detail surfaces from `useReactiveServerQuery` to `useQuery` once their composite is pure
  Convex. Realistically a multi-PR program (~1–2 weeks), not a single change.
- **Deletes a whole class:** no per-composite scoping treadmill (#2 stops recurring), no
  double refetch (#3 moot), no server-roundtrip-per-tick latency floor, true incremental
  reactivity. Aligns with the stated 12-month ideal (detail pages are pure subscriptions).
- **Risk:** medium. Auth data in Convex (mitigated: non-sensitive fields only, Better Auth
  remains source of truth). Must keep the mirror in sync on user rename/avatar change (one
  more mirror, same pattern as the rest). A few composites join user for *write*-side audit
  fields — those stay server-side regardless.

## Recommendation
**Phased hybrid, leaning to B as the destination.**
1. **Now:** keep taking the cheap Option-A wins where they stand alone (#2 getKit/getAsset
   already shipped; #3 after they land). They're low-risk and help immediately.
2. **Commit to B as the architecture target** and do the cheap unlock first: **mirror the
   `user` table into Convex** (1 table + mirror, ~1 PR). This is the keystone that makes
   every later composite convertible — and it's small.
3. **Then convert surfaces opportunistically:** when a detail surface next needs work,
   convert its composite to pure Convex + swap `useReactiveServerQuery` → `useQuery`, instead
   of doing another Option-A scoping pass on it. Each conversion deletes that surface's
   waterfall permanently.

**Why B wins the fork:** the per-composite scoping work (Option A) is real but it's paying
down interest, not principal — the same waterfall keeps generating new findings (#2, #3, the
over-broad version vectors, the double-fetch). Mirroring users is a bounded, one-time
principal payment (~48 mechanical edits + 1 small table) after which detail pages can become
pure subscriptions and the entire class of waterfall findings disappears. The trigger half is
already pure Convex; users are the only thing standing between today and pure subscriptions.

**Do NOT do:** a big-bang rewrite of all 4 surfaces + 48 joins at once. Mirror users first
(small, safe, independently valuable), then convert surface-by-surface behind the existing
green tests.

## Next concrete step
A scoped PR: add a Convex `users` table (mirror of Better Auth user: id, name, email, image,
+ org membership as needed) and the mirror write path, with a parity test. That unblocks
everything else and is the smallest derisking move. Everything after it is mechanical and
incremental.
