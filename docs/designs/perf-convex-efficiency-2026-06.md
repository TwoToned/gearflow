# Performance Deep-Dive: Why the App Is Slow & Chatty (June 2026)

**Symptom (user report):** "Every tiny thing you do makes heaps and heaps of Convex DB
calls. It's so inefficient and slow to do anything."

**Verdict:** The symptom is real and the cause is structural, not a single bug. It comes
from three compounding patterns introduced/amplified by the Prisma→Convex migration:

1. **Whole-org list subscriptions** — list pages subscribe to entire org tables and
   filter/paginate in the browser. Any single-row write re-pushes the whole table to
   every viewer.
2. **Version-vector → full server-action refetch** — detail pages (kit/asset/warehouse)
   watch a cheap Convex "version" value, then on every tick re-run a server action that
   **re-reads the entire org inventory** to render one entity. And it fires **twice** per
   local edit.
3. **N+1 / over-fetch fan-out in Convex** — warehouse hot paths load the same rows 2–3×
   and walk per-row queries; one missing composite index forces full-table scans of the
   hottest table.

None of this is "Convex is slow." It's "we ask Convex for the whole org, repeatedly, for
work that should be a scoped, indexed, paginated read." All findings below carry
`file:line` evidence and were verified against source.

---

# ⟳ STATUS & RE-EVALUATION (2026-06-27)

The original plan + autoplan review below are the design-of-record. This section is the
**current truth**: what shipped, what dogfooding surfaced, the research-backed root-cause
framing, and the revised priority order. Read this first.

## Shipped to prod (main)
| PR | What | Effect |
|----|------|--------|
| #276 | iCal `getByIcalToken` indexed (#9) | closed an externally-triggerable cross-org scan (DoS) |
| #282 | **Keystone**: `getKit`/`getAsset` scoped to the entity (#2) + `by_projectId_status` index (#5) | detail reads went O(org inventory) → O(entity) |
| #283 | **Add/edit-item N+1 fix** (line-items) + **projects-view per-model N+1** (availability) + warehouse de-dup (#6a) | killed the "~1 min / hundreds of calls" add/edit hang and the `assets:listByModel` wall on the projects view |

## New findings from dogfooding (were NOT in the original plan)
- **F-A. Add/edit a project item = hundreds of calls (`line-items.ts`).** `addLineItem` /
  `updateLineItem` / `checkAvailability` ran their double-booking & availability checks with
  a **per-unit `getById` loop** over the org's **entire** unit table, plus **whole-org
  `projectLineItems.list` at 5 sites**. → fixed in #283 (new scoped queries
  `listByOrgAndAsset`, `listByModelId`; batched the loop). **This is the same class as #2 —
  a server action doing the fan-out as N network calls instead of one scoped read.**
- **F-B. Projects view = per-model `listByModel` fan-out.** `computeOverbookedStatus` fired
  `assets.listByModel` + `bulkAssets.listByModel` **per model** (2N round-trips). → fixed in
  #283 with batched `listByModelIds` (2N → 2).
- **F-C. The fixes are not whack-a-mole — they're all the same root cause** (below). There
  are almost certainly more instances (`getProject` composite is the prime suspect, next).

## Research-backed root cause (deep-research, 2026-06-27 — cited)
**The slowness is a Prisma→Convex *port artifact*, not "Convex is slow."** Verified math
(primary sources: graphql/dataloader, graphql-js.org, Shopify Engineering):
- **N+1 = 1 parent query + N child queries.** The count scales **linearly with data** (50
  rows → 51 round-trips; 1,000 → 1,001). **Total wait ≈ round-trip count × RTT.** At
  ~20 ms/trip, a few hundred sequential trips = **seconds**. That is exactly what we see.
- **In Prisma/SQL, one logical read = one round-trip** — the JOIN happens *inside Postgres*
  (microseconds). **The port turned each `include`/relation/`findMany` loop into a separate
  Convex *network* query**, so 1 round-trip + internal joins became dozens of network trips.
  Same data, ~50× the trips. The thin `*-read.ts` wrappers called in `.map()` loops are the
  fingerprint.
- **Canonical fix (cited): resolve/join on the server, return ONE payload.** DataLoader-style
  batching collapses "4 round-trips → at most 2"; an 11-query fan-out → 1. Deterministic, not
  a benchmark.
- **Convex-native form of the fix** (Convex docs / Stack — search-surfaced, lighter citation
  due to a rate-limited verification pass, but established): do the fan-out **inside one query
  function** (reads there are backend-local microseconds, not network) using the relationship
  helpers (`getAll`/`getManyFrom`/`getManyVia` + `Promise.all`); use `@convex-dev/aggregate`
  for counts/sums (O(log N), incrementally maintained); use Convex **optimistic updates** and
  the "Help, my app is overreacting" guidance for the reactive/refetch storm.
  Refs: stack.convex.dev/functional-relationships-helpers · convex.dev/components/aggregate ·
  docs.convex.dev/client/react/optimistic-updates · stack.convex.dev/help-my-app-is-overreacting.
- **Why Linear/Figma feel instant** (local-first; established, lightly cited here): the action
  doesn't round-trip at all — optimistic **local write** + normalized client cache + background
  sync. The per-action round-trip is off the critical path.

## The three levers (everything reduces to these)
1. **Move per-row/per-model loops INTO one Convex query function** (server-side fan-out → one
   payload). Biggest, lowest-risk, proven (#2, #283). **More to do — audit every `src/server/*`
   composite for whole-org `.list` + `.map(query)` loops; `getProject` next.**
2. **Delete the version-vector → server-action waterfall; use native Convex `useQuery`
   subscriptions.** Native subs push only what changed, incrementally, no per-tick server
   roundtrip, no double-refetch. The research's own open question landed here independently:
   *"is the manual refetch a porting artifact to delete?"* — yes. Blocker = the Better-Auth user
   join → the **user-mirror unlock** (T1 spike #281).
3. **Optimistic updates so writes feel instant** — Convex `optimisticUpdate` (light) up to the
   full local-first tier (the Linear bar the user is asking for).

## Revised priority order (supersedes "Recommended sequencing" below)
1. **DONE** — #2 keystone, #5 index, #9 iCal, F-A/F-B add-edit + projects-view N+1 (#283).
2. **`getProject` composite + a sweep of `src/server/*` for the same whole-org-read / N+1-loop
   pattern** (lever 1). Same quick, high-confidence scoping fix; `getProject` is the shared
   post-write refetch path behind add/edit/**delete**. ← **NEXT.**
3. **User-mirror → kill the version-vector waterfall** (lever 2, T1 spike #281). The
   architectural root-cause fix; makes detail pages pure incremental subscriptions and removes
   the double-refetch entirely. Biggest structural win.
4. **Optimistic updates** (lever 3) once #2/#3 land — the "pretty much instant" bar.
5. **Asset-list pagination** (Phase 2 / T3 denormalize+searchIndex) — still valid; lower
   urgency than the write-path/refetch storm the user actually hits.
6. **Infra debt:** the **~18 warehouse/category integration tests broken on shared dev** block
   validating warehouse work (and #6b) — worth a focused fix.
7. **Deferred:** #6b nested-kit (blocked on test env), #3 double-refetch (subsumed by lever 2).

---

## The smoking gun, in one example

Open one kit detail page and edit one field. Here's what happens:

- `getKit()` (`src/server/kits.ts:71`) runs. To render **one kit**, it does
  `Promise.all` of: `getKitSerializedItemsByOrg`, `getKitBulkItemsByOrg`,
  **`getAssetsByOrg`** (the whole asset registry — the biggest table in the app),
  **`getBulkAssetsByOrg`**, `getModelMap`, **`getProjectsByOrg`** (every project),
  `getMaintenanceRecordsByOrg`, plus scan logs. → `src/server/kits.ts:88-99` (verified).
- That's O(entire org inventory) of DB reads to show one kit's contents.
- The edit mutation moves the kit's version vector (`convex/kitDetail.ts:90`, which
  includes `kit.updatedAt`), so the `useReactiveServerQuery` watch fires → **a second full
  `getKit` refetch**. The page also calls `refetchKit()` in its mutation `onSuccess`
  (`kits/[id]/page.tsx:157,166,179,191,205,219,536,556`) — so **2× whole-org reads per
  single edit**.

The same shape applies to **asset detail** (`getAsset`, `src/server/assets.ts:132` — pulls
`getProjectsByOrg` + `getMaintenanceRecordsByOrg` org-wide to render one asset) and the
**warehouse** pages.

---

## Findings ranked by impact (frequency × rows)

### Tier 1 — the structural slowness (fix these first)

**1. List pages subscribe to whole org tables + paginate client-side.**
The asset list mounts **five** full-table org subscriptions at once — `useAssets`,
`useBulkAssets`, `useModels`, `useLocations`, `useCategories`
(`src/components/assets/asset-table.tsx:352,372,392-394`; gallery repeats them at
`asset-gallery.tsx:44-47`). Filtering, sorting, **and pagination are all client-side over
the full set** (`asset-table.tsx:425-506`) — pagination is cosmetic; the whole table is
already on the wire. `convex/assets.ts:16` is a whole-org `.collect()` (verified).
*Cost:* O(org assets) re-pushed to **every** open asset-list tab on **any** single
check-in/out anywhere. This is the #1 driver of "heaps of calls on every action."
*Fix:* Server-side filter + paginate. Move status/location/category/search + paging into
an indexed paginated Convex query (`usePaginatedQuery` / `paginate()`) so each tab
subscribes to loaded pages instead of the whole table. (Caveat — see "Convex limits":
loaded pages stay reactive and re-run on in-range writes; only filters that map to an index
move server-side cheaply; don't full-scan for `totalPages`.) Same treatment for
`useProjects` (which today also returns templates and filters them client-side —
`use-projects.ts:31`).

**2. `getKit` / `getAsset` read the whole org to render one entity.**
`src/server/kits.ts:88-99` and `src/server/assets.ts:168-169` (verified). These are the
`queryFn`s behind the reactive detail pages, so the waste is paid on first paint **and** on
every version tick.
*Fix:* Scope the reads to entity contents.
**⚠️ Corrected by eng review (both voices): this is NOT a "read by id" refactor — the
by-entity queries don't exist yet and must be built first.** Required new, `requireOrgRead`-
scoped Convex queries + read helpers (or a cross-org read hole opens): `kitSerializedItems.
listByKitId`, `kitBulkItems.listByKitId` (the `by_kitId` index exists, no query uses it),
`assets.listByIds` + `bulkAssets.listByIds` (absent today — only `getById`/org-`list`), and
a kit-scoped scan-log query (`assetScanLogs.by_kitId` index DOES exist, schema.ts:1005 — just
unused). For `getAsset`, `getMaintenanceRecordsByOrg` (assets.ts:169) is reading every org
maintenance record then JS-joining — replace with an id-scoped read (`maintenanceRecord
Assets.listByAssetIds` is already used at :160, so the org-wide doc read is the wasteful
half). **Ship the new queries as additive PRs first (land + deploy), THEN rewire the
composites — do not inline-rewrite the hottest detail path.** Verified safe: the org-wide
reads are used only to build per-entity filter maps, nothing cross-references the whole
registry. Gate on a getKit/getAsset **parity test** (T-C/T-D) before rewiring.

**3. Double refetch on every local mutation (version watch + explicit `refetch`).**
By design (`use-reactive-server-query.ts:42-47`) but not free: each local write fires the
explicit `refetch()` **and** the watch tick → two full composite refetches. Warehouse
detail calls `invalidate()` at ~24 sites (`warehouse/[projectId]/page.tsx:496…2994`); a
check-out loop fires this per batch.
*Fix:* Once the queryFns are cheap (fix #2), drop the explicit same-view `refetch()` and
let the vector drive a single refetch — or debounce/coalesce ticks during scan loops.

**4. Project detail mounts ~13+ live subscriptions in one tree.**
Equipment alone opens 4 (`use-project-equipment.ts:107-110`: lineItems, groups,
categories, subHires), plus services, crew, tasks, crewRoles (×2), and **5 collaboration
subscriptions** (locks, comment counts, presence, blocking summary, activity feed —
`equipment-tab.tsx:134-141`, `use-collaboration.ts:86`, `project-comments-button.tsx:21`,
`activity-feed.tsx:67`). Presence/locks update frequently.
*Fix:* Collapse the equipment 4-way fan-out into one composite Convex query. Lazily mount
collaboration subscriptions per **open tab/panel** instead of all at page load.

### Tier 2 — Convex query inefficiency (server-side reads)

**5. Missing `projectLineItems` composite index → full-table scan (ONE hot site).**
`projectLineItems` has only `by_projectId` (`convex/schema.ts:827` — verified; no
`by_projectId_status`).
**⚠️ Corrected by eng review (both voices): the index helps ONE site, not five.** Of the
cited `warehouseOps.ts` lines, only **`checkInBulkTotals:645`** filters
`status === "CHECKED_OUT"`. The other four are NOT status filters: `556`/`577` compute
`max(sortOrder)` over the whole project (`quickAdd`/`ensureContainerOnProject`), `594`/`608`
filter `prepContainer` (`clearPrepContainer`/`syncContainerStatus`). A status index can't
help those — they're inherently whole-project scans (or would need a separate
`by_projectId_prepContainer` index).
*Fix:* Add `.index("by_projectId_status", ["projectId","status"])` and convert the **one**
`checkInBulkTotals` site (the remaining `status==="CHECKED_OUT" && !subHire && accessory`
predicate stays a JS post-filter on the now-smaller candidate set). Still worth it
(`checkInBulkTotals` is hot), but it's one site, not "the most pervasive over-fetch." Index
+ consuming code must land in the **same commit** (prod runs `convex deploy` before the app
image swaps). Check the per-table index budget first (assets/projectLineItems carry ~15).

**6. Warehouse checkout re-loads the same line docs 2–3×.**
`checkoutItems` loads each project's lines/units three times across
`gatherTestTagAssetsAndAssert` → `expandPrepUnitAssignments` → main loop
(`warehouseOps.ts:161,189,231`). `checkInBulkTotals → toInput` does per-row
`models.by_cuid` + `lineUnits` in a loop (`warehouseOps.ts:649-667`, N×2 reads). Nested kit
checkout/checkin fetches `childLines` twice per nested child and calls `setAssetsStatus`
~6× over overlapping sets (`warehouseOps.ts:340-396`).
*Fix (SPLIT into two tickets per eng review):*
- **#6(a) — `checkoutItems` pre-mutation dedup (LOW risk, covered by tests).** Load each
  project's lines+units once and thread through the *read-only pre-mutation* stages
  (`gatherTestTagAssetsAndAssert` → `expandPrepUnitAssignments`). One Convex mutation is one
  serializable transaction, so the re-read returns the same snapshot — caching is safe.
  **But do NOT thread cached child/unit docs past a stage that creates/flips them**
  (`finalizeCheckoutItem`/`expandAccessoriesForAsset` depend on prior writes being visible —
  re-read those). Batch distinct model ids into a `Map` in `checkInBulkTotals`.
- **#6(b) — nested-kit `setAssetsStatus`/`childLines` consolidation (HIGH risk, ZERO test
  coverage).** `checkoutKit`/`checkinKit`/`forceReturnKit` (warehouseOps.ts:340-396,503-536)
  call `setAssetsStatus` ~6× over overlapping sets; the final pass intentionally re-stamps
  top-level kit assets *after* children (last-write-wins location). Naive set-union dedup can
  change the final location/status. **Ship-blocked on a nested-kit round-trip test (T-A/T-B)
  asserting final status AND location** — neither voice found any existing coverage for these
  three mutations.

**7. Unbounded / mis-indexed check-record reads.**
`checkRecords.ts:53 listRecentByAssetAndCheckItem` collects an asset's **entire**
append-only check history then JS-filters + sorts + slices; `listByOrgAndAsset` (`:40`) is
unbounded.
*Fix:* Add `by_org_asset_checkItem_performedAt`, use `.order("desc").take(n)`.

**8. `swapLineItemAsset` full-scans all org projects** for a double-booking check
(`projectLineItems.ts:599` — `projects.by_organizationId.collect()` then JS date-window
filter), on every asset swap.
*Fix:* Add a date/status-ranged projects index and range-scan.

**9. `getByIcalToken` full-table scan despite an existing index** (verified
`crewMembers.ts:49` — `.collect().find()` while `by_icalToken` exists). Cross-org,
externally triggerable via the public iCal URL (scrape-able DoS).
*Fix:* `.withIndex("by_icalToken", q => q.eq("icalToken", icalToken)).first()` — one line.

### Tier 3 — smaller / structural debt

- **`useCrewRoles` subscribed twice** on project detail (`services-panel.tsx:49`,
  `crew-panel.tsx:42`) — lift to page, pass down. (Convex shares the socket, so minor.)
- **Over-broad version vectors** include `updatedAt` (`kitDetail.ts:90`,
  `assetDetail.ts:110`) so a warehouse status sync that only bumps `updatedAt` triggers a
  full detail refetch even when that field isn't rendered (`assetDetail.ts:44` documents
  this). Trim where the bumped field isn't page-visible.
- **`warehouse/page.tsx` list** pays a 100-project `getProjects(includeLineItems:true)`
  server roundtrip (`warehouse/page.tsx:252`) for card data the `listVersion` query already
  collects — a candidate to become a pure native `useQuery`.
- **Architectural tax (not a quick win):** the Convex→server-action version-vector
  waterfall (`use-project-detail.ts:31-49`, `use-reactive-server-query.ts`) exists because
  Convex can't hold Better Auth user joins. It's correct, but every detail page pays
  "Convex push → detect change → second server roundtrip → full Prisma composite re-read."
  Long-term: narrow the composites so a write refetches only the changed slice, or migrate
  the cross-domain joins into Convex so detail pages are pure subscriptions.

### Confirmed NON-issues (so we don't chase ghosts)

- **Inline object-literal args do NOT churn subscriptions.** Convex `useQuery`
  value-compares serialized args before teardown (`queries_observer.js:29`). No `useMemo`
  needed on Convex args for perf. (An earlier suspicion; debunked.)
- **App shell is clean** — zero always-on Convex subscriptions in `(app)/layout.tsx`,
  sidebar, top-bar, providers. `useOrganization`/`useCurrentRole`/`useProfile` are deduped
  server actions off the in-memory session. The dashboard uses server actions, not
  subscriptions. Good as-is.
- **Migration discipline was high** — of ~593 terminal reads, only ~5 lack any index; the
  many `listByXIds` batch helpers are the *intended* N+1 fix (indexed point-reads over a
  bounded set). The problem is concentrated, not pervasive.

---

---

# Part 2 — Making it feel *instant* (preload / prefetch / cache)

> **STATUS: DEFERRED behind the re-measurement gate (autoplan decision 2026-06-26).** Only
> `loading.tsx` skeletons (P2) ship in this effort. P1/P3/P5/P6 re-enter only if post-Part-1
> measurement still shows a perceived-latency gap. **P4 is DROPPED** (own security doc). The
> mechanics below are retained as the design-of-record for if/when the gate opens.

Goal (user request): "When someone goes onto a page, load all the stuff that page may
need in the background — I want it to almost-instant load."

**Current state (verified):** `convex-helpers` is **not** installed; there are **zero**
`loading.tsx` route skeletons; and there is **no** preload / prefetch / optimistic-update
usage anywhere in `src`. So everything below is additive greenfield.

**The hard dependency (read this first):** prefetching is a *multiplier* on per-query cost.
Prefetching today's whole-org `useAssets`/`getKit` on hover would pull the entire org
inventory on hover instead of on click — strictly worse. **Preload/prefetch must land on
the scoped, paginated, indexed queries from Part 1**, or it amplifies the exact problem
we're fixing. Order matters; see sequencing.

A second structural note specific to this app: detail pages are **not** pure Convex
`useQuery` — they use the version-vector → server-action composite (`getKit`/`getAsset`/
`getProject`) because they join Better Auth users. So the two "instant" toolkits split:
Convex `preloadQuery`/`usePreloadedQuery` works for the **pure-Convex** surfaces (lists,
equipment, collaboration), while the **server-action detail composites** get instant-paint
via RSC `initialData` seeding + intent-prefetch into a shared cache.

> **Codex review corrections (2026-06-26, applied below).** An independent Convex-focused
> review flagged five things this section originally got wrong or glossed. They are
> corrected inline in P1/P3/P4 and the sequencing; summarized here so the change is visible:
> 1. **The keep-alive cache is NOT a Phase-0 freebie.** `ConvexQueryCacheProvider` holds the
>    **WebSocket subscription open** after unmount — on today's whole-org queries that
>    *prolongs* the worst subscriptions. Only `loading.tsx` skeletons are a true freebie.
> 2. **List pagination is likely the #1 priority, not Phase 3.** Whole-org *live list tabs*
>    are the biggest cross-user multiplier and match "every tiny thing while tabs are open"
>    most directly. Reordered.
> 3. **A one-shot `convexClient.query()` does NOT populate the cache provider** (it's not a
>    live cached subscription). P3 corrected to use the real warm-the-cache mechanism.
> 4. **SSR `preloadQuery` needs a per-request *user* JWT** minted from the session — the
>    process-global service token would bypass per-user read scoping and leak data across
>    users. This is the biggest hole; P4 now carries an explicit auth-safe design or is
>    dropped in favour of skeletons + client cache.
> 5. **Convex limits + prefetch backpressure** were missing — see "Convex limits & risks".

## Mechanisms to add (each is a discrete unit of scope)

**P1. Convex query keep-alive cache (broad win — but NOT a freebie; gate behind scoping).**
Install `convex-helpers` and wrap the tree in `ConvexQueryCacheProvider`
(`convex-helpers/react/cache`) inside `convex-provider.tsx`. Convex normally drops a
query's result the moment the last subscriber unmounts; the cache provider holds results
for a TTL after unmount. Effect: **back/forward navigation and revisits are instant** (no
refetch flash), and it's what makes hover-prefetch "stick" until the click lands.
**Correction (codex):** the provider keeps the **WebSocket subscription open** for the TTL,
so the query keeps re-running on writes *after* unmount. On today's whole-org list queries
that *prolongs* the most expensive subscriptions — it is **not** "safe to add now."
**Land it AFTER Part 1 scopes/paginates the queries**, and even then configure a tight TTL
and `maxIdleEntries` (low `expiration` / bounded entry count) so cache memory and live-sub
count don't balloon per tab. Until scoping lands, leave it out.

**P2. Loading skeletons (the one shipping instant-feel item — corrected by design review).**
Original premise ("zero skeletons exist; add `loading.tsx` to cover the blank/spinner gap")
was **half-wrong**. These four routes are `"use client"` pages whose data resolves through
client-side Convex subscriptions (`useAssets === undefined`) and the `useReactiveServerQuery`
version-vector (`isLoading`) — *past* the `loading.tsx` Suspense boundary. So `loading.tsx`
only covers the route-transition + JS-parse gap, then unmounts when the client component
mounts and that component's own loading branch takes over. Several already self-skeleton
(kit detail renders `DetailPageSkeleton`). A DESIGN-compliant skeleton kit already exists at
`src/components/ui/skeleton.tsx` (solid `--elev` pulse, no shimmer). Corrected requirements:
  - **Audit each route's existing `isLoading` branch first** — don't treat all four as
    greenfield. Where the component already self-skeletons, either skip `loading.tsx` or make
    both render the *same* composite so there's no skeleton-A → skeleton-B double flash.
  - **Reuse the existing skeleton kit** (`ListPageSkeleton`/`DetailPageSkeleton`/`TableSkeleton`)
    — no bespoke skeletons, no gradient shimmer (DESIGN calls it an anti-pattern).
  - **Match outer dimensions to prevent layout-shift (CLS):** same page padding, same 63/37
    detail split, pinned table row height. The generic `DetailPageSkeleton` (3-col grid + 3
    tabs) will shift on project/warehouse — tailor per route.
  - **Warehouse = chrome-only skeleton + a simple pulse for the volatile body**, NOT a full
    structural skeleton (it's the most-variable composite — a bespoke skeleton there will
    mismatch and shift).
  - **Flash guard:** delay-before-show (~100–150 ms) + min-display (~200 ms, per DESIGN) in
    the in-component loading branch, so sub-200 ms loads don't strobe.
  - **States beyond loading (DESIGN §8 — required, currently unspecified):** decide `error.tsx`
    per route now (Convex/`getKit` failures have no route boundary today); ensure skeleton →
    empty resolves and never masks an empty result. Even if `error.tsx` is deferred, name it
    as a known gap so it isn't silently dropped.

**P3. Intent-based prefetch on hover/focus/viewport (the "load it before they click" ask).**
Add a `usePrefetchOnIntent(href, prefetchFn)` hook wired to `onMouseEnter` / `onFocus` /
`IntersectionObserver` on list rows and nav links. On intent it does two things:
  - `router.prefetch(href)` — warms the Next.js RSC route payload.
  - **warms the data, correctly:** a one-shot `convexClient.query()` does **NOT** populate
    the cache provider (codex) — it's a fire-and-forget read, not a live cached
    subscription, so the value is gone by click time. To actually warm a pure-Convex
    target, mount a hidden/idle subscription via the cache provider's own API (the
    `useQueries`/cached-`useQuery` path the provider exposes) so the entry is registered in
    the cache and held by TTL. For server-action detail targets, call the server action
    (e.g. `getKit(id)`) and stash the result in the shared resource cache the
    `useReactiveServerQuery` reads, keyed by identity.
  - **Backpressure (codex):** hovering across a table row-by-row can stampede server
    actions. The hook MUST debounce intent (~100–150 ms), dedupe in-flight prefetches by
    key, cancel superseded ones, and cap concurrency.
By click time the page reads warm cache → near-instant. **Depends on Part 1** (the
prefetched queries must be scoped, or hover = whole-org pull) **and on P1**. Start with the
highest-value hop: project-list → project-detail, asset-list → asset-detail,
warehouse-list → warehouse.

**P4. SSR preload for first paint — REQUIRES an auth-safe design (the plan's biggest hole).**
The goal: hydrate first paint with data already present instead of auth→subscribe→fetch.
**Hard constraint (codex):** this app's Convex identity is a **per-user JWT fetched in the
browser** via `/api/auth/token` + `ConvexProviderWithAuth`. A server component does **not**
automatically have that token. So:
  - `preloadQuery(api.x.y, args, { token })` is only viable if the RSC **mints a per-request
    user Convex JWT from the Better Auth session** and passes it as `token`. Reusing the
    process-global **service token** here is forbidden — it bypasses per-user read scoping
    and risks serializing one user's data into another's route (a data-leak footgun).
  - **Decision gate:** either (a) build the per-request user-JWT minting path in RSC and use
    `preloadQuery`/`usePreloadedQuery` for pure-Convex pages, **or** (b) skip SSR preload
    entirely and rely on P2 skeletons + P1 client cache + P3 prefetch for the "instant"
    feel. Option (b) is the safe default if the JWT-minting path isn't already available;
    pick (a) only with an explicit auth review.
  - For server-action detail pages, the lower-risk path is RSC `initialData` seeding: run
    the queryFn server-side (it already uses the server session, not the browser token) and
    seed it into `useReactiveServerQuery` via a new `initialData` param that populates
    `result` before the first watch tick. This sidesteps the Convex-token problem because
    the server action authenticates the normal server way.
**Depends on Part 1** (don't SSR-preload a whole-org read) **and a security sign-off on the
token path.** Medium effort; treat option (a) as its own design doc.

**P5. "Prefetch the whole bundle a page needs" (the literal ask, done safely).**
Once detail composites are scoped (Part 1 #2), a detail page's data is a small, known set
of scoped queries (e.g. asset detail = media + line-items + scan-logs + model). Add a
single `prefetchAssetBundle(id)` / `prefetchKitBundle(id)` that fires all of them in
parallel on intent (P3) or on adjacent-page load. Because each leg is now scoped + indexed,
firing them ahead is cheap. This is exactly "load everything the page needs in the
background" — but it's only safe *after* the queries are scoped. **Depends on Part 1 #2.**

**P6. Optimistic updates on mutations (the other half of "slow to do anything").**
"Slow to do anything" isn't only reads — every edit today waits for `server action → Convex
mirror → refetch` before the UI moves. Add optimistic UI so the change paints immediately
and reconciles on confirmation. Because writes go browser → server action (not direct
Convex mutation), this is a React-level optimistic patch: have the mutation hook
(`use-server-mutation.ts`) apply an optimistic value into the reactive-server-query
result, then let the version-tick refetch reconcile. Makes edits feel instant; pairs
naturally with dropping the doubled refetch (Part 1 #3). Medium effort, high "feel" payoff.

## Convex limits & risks (codex additions — design around these)

- **`.collect()` has hard ceilings, not just slowness.** A Convex query function reads at
  most ~16 MB / a bounded row count per run; org-wide `.collect()` on `assets`/`projects`
  will eventually **fail outright** as orgs grow, not merely lag. This makes the Part 1
  scoping/pagination work a *correctness* requirement, not just perf.
- **Index budget.** Convex caps indexes per table. `projectLineItems` already carries
  several; adding `by_projectId_status` is fine, but track the budget — don't start adding
  one index per query reflexively. Prefer composite indexes that serve multiple call sites.
- **Pagination is still reactive.** `usePaginatedQuery` reduces result *size* to loaded
  pages, but every loaded page stays subscribed and re-runs on writes touching its range;
  an insert/delete before a page boundary shifts and re-pushes pages. "Subscribe only to
  the visible page" is only true before the user pages further. Don't compute `totalPages`
  via a full scan — it reintroduces the whole-table read.
- **Client-side search/sort can't all move server-side for free.** Arbitrary substring
  search/sort needs a matching Convex index or a search index; pagination only stays cheap
  for filters that map to an index. Audit the asset-list filter set before committing.
- **Cache + prefetch multiply *live* subscriptions.** Keep-alive TTL × hover-prefetch ×
  open tabs = many concurrent open subscriptions. Bound TTL, `maxIdleEntries`, and prefetch
  concurrency, or the "instant" layer trades read latency for steady-state WS load.
- **Interval-overlap isn't a two-field index.** The "date/status-ranged projects index" for
  the double-booking check (Part 1 #8 / `projectLineItems.ts:599`) is underspecified — a
  Convex range index can bound one side of an interval-overlap test but not both; the real
  fix is range-scan on a start/end bound **plus** an in-JS overlap post-filter on a small
  candidate set. Spell that out before implementing.

## Honest expectation-setting

- **P2 alone** is the only immediate near-zero-risk win (skeletons → navigation *feels*
  instant). **P1 (cache) is NOT a freebie** — it holds subscriptions open and must wait for
  scoping/pagination (see P1 correction).
- P3 + P5 deliver the "already loaded before I clicked" experience — but only pay off, and
  only stay safe, once Part 1 scopes the queries and P1's warm-cache mechanism is in place.
  Prefetching un-scoped queries is a net regression.
- P4 (first-paint preload) is gated on an **auth-safe token path**; default to the
  `initialData` server-action seeding and skeletons unless the user-JWT-in-RSC path gets a
  security sign-off. P6 makes *writes* feel instant via a React-level optimistic patch
  (Convex `withOptimisticUpdate` is not usable here — writes don't go direct to Convex).
- "Almost instant" is achievable, but the gating work is Part 1 (scope + paginate +
  index), not the prefetch layer. Build the foundation first or the instant layer amplifies
  the current problem.

---

## Recommended sequencing

> **⚠️ SUPERSEDED by "STATUS & RE-EVALUATION (2026-06-27)" at the top of this doc.** The
> ordering below was the pre-implementation plan; #2/#5/#9 + the dogfooding N+1s have since
> shipped, and the research reframed the work around the 3 levers. Kept for history.

**Rewritten after the autoplan review (premise gate: "Part 1 first, gate Part 2").** Measure
first, ship the backend foundation + skeletons, prove it with numbers, then decide whether
the instant-feel layer is even needed. Part 2 below is DEFERRED, not scheduled.

**Phase 0 — MEASURE (do before any code; settles the unproven premise):**
- Capture a Convex-dashboard baseline on the hot flows: open kit detail + edit one field;
  open asset list; warehouse checkout/checkin loop; open project detail. For each record:
  function-call count, documents/bytes read, p50/p95 latency, and **# reactive re-runs after
  one mutation**. Set targets (e.g. "kit-detail edit → ≤1 detail refetch, ≤N docs, p95 ≤X").
  This disambiguates call-count fan-out vs payload-size before picking fixes.

**Phase 0.5 — security hotfix (ship today, independent of the perf roadmap):**
- Fix `getByIcalToken` to use its `by_icalToken` index (#9). Externally-triggerable
  cross-org scan = a DoS, not a perf nicety. One line; do not queue it behind perf work.

**Phase 1 — biggest efficiency wins, low risk (the keystone backend fixes):**
- Scope `getKit` / `getAsset` to entity-level reads (#2). **[promoted]** Kills the 2×
  whole-org refetch on every kit/asset detail edit — the "smoking gun."
- Drop the doubled same-view `refetch()` once queryFns are cheap (#3).
- Add `projectLineItems.by_projectId_status` index; convert the 5 warehouse scan sites (#5).
- De-dup line/unit loading in `checkoutItems` + batch models in `checkInBulkTotals` (#6).
- Re-measure against the Phase 0 baseline.

**Phase 2 — paginate the live lists (biggest cross-user multiplier + correctness):**
- Server-side filter + paginate the asset list (and projects); subscribe to loaded pages,
  not the whole table (mind the pagination-is-still-reactive caveat — no full-scan
  `totalPages`). Bake `isTemplate: false` in (#1). Also removes the Convex read-size-ceiling
  failure risk on whole-org `.collect()`.
- **Pagination architecture (T3 — chosen: denormalize + searchIndex).** Denormalize
  `model.name` (and `categoryId`) onto the asset row and add a Convex `searchIndex`, so
  searched/filtered/sorted asset views stay **live-updating AND correct server-side** (no
  partial-page wrong-results footgun, no loss of reactivity). Build the denormalization as a
  mirror that stays in sync on model rename / asset model-change (this is the one new
  maintenance surface T3 buys — write the sync path + a test for it). Pagination then routes
  every filter/sort through indexes, not client-side JS. Tests T-F/T-G/T-H gate correctness.
- **Ship Part 1 + Phase 2 + the `loading.tsx` skeletons (P2). Re-measure.**

**Phase 3 — trim the detail-page fan-out (still backend/perf, not "instant-feel"):**
- Collapse the equipment 4-subscription composite into one query; lazy-mount collaboration
  subscriptions per open tab (#4). Trim `updatedAt` from version vectors where unused.

**═══ RE-MEASUREMENT GATE ═══**
Compare against Phase 0 targets. **If navigation/edits already feel instant, Part 2 is
cancelled.** Only if a measured perceived-latency gap remains do the deferred items below
get scheduled — each then justified by its own number.

**Part 2 (DEFERRED — gated, not scheduled):** P1 keep-alive cache, P3 intent-prefetch,
P5 bundle-prefetch, P6 optimistic updates. Mechanics unchanged from the sections above; they
re-enter only through the gate.

**DROPPED from this effort:** P4 (RSC `preloadQuery` / per-request user-JWT SSR). It's a
security-architecture decision with a data-leak failure mode — it gets its own
security-reviewed design doc, never a perf ticket.

**★ Architectural spike (T1 — APPROVED at gate). Do this EARLY, alongside Phase 0–1.**
Time-box ~1 day: size "narrow the composites" vs "move the Better-Auth user joins into Convex
so detail pages become pure `useQuery` subscriptions and the version-vector → server-action
waterfall is **deleted**." The waterfall is upstream of findings #2/#3 (it's *why* getKit/
getAsset are full composites and *why* there's a double-refetch). If the replace cost is
comparable to the sum of per-composite scoping, replace wins — it deletes a whole class of
future findings. **Gate the #2 scoping investment on this spike's result:** if replace is
chosen, the new by-id queries from #2 may be subsumed by pure subscriptions, so don't over-
build them first. Cross-phase theme (CEO + Eng converged) → highest-confidence signal in the
review.

---

## The three single highest-leverage fixes

1. **Add `projectLineItems.by_projectId_status` and convert the warehouse scans** — one
   index removes the most pervasive over-fetch on the hottest table on the hottest path.
2. **Scope `getKit`/`getAsset` to entity-level reads** — stops every kit/asset detail view
   (×2 per edit) from re-reading the entire org inventory.
3. **Server-side paginate the asset list** — stops every check-in/out anywhere from
   re-pushing the whole asset table to every open list tab.

---

# GSTACK AUTOPLAN REVIEW (2026-06-26)

Pipeline: CEO → Design → Eng (DX skipped — not a developer-facing product). Dual voices
(Claude independent subagent + Codex) per phase. Intermediate decisions auto-resolved via
the 6 principles; premises + user challenges gated to the user.

## Phase 1 — CEO Review (strategy & scope)

**Consensus:** 5/6 dimensions CONFIRMED-NO (both voices independently agree the plan has
real strategic gaps); 1 DISAGREE (waterfall: optimize-around vs replace → taste).

### What already exists (don't rebuild)
- Diagnosis + `file:line` evidence is accurate and verified (getKit→getAssetsByOrg,
  convex/assets.ts whole-org collect, iCal full-scan). The plan's *findings* are sound.
- The 9 backend findings map to concrete existing code; no new infra needed for Part 1.
- Convex dashboard already exposes the metrics the plan needs (per-function calls, bytes/
  docs read, latency) — measurement is available, just unused.

### NOT in scope (deferred — rationale)
- **P4 (RSC per-user-JWT SSR preload)** — DROPPED from this perf effort. It's a security-
  architecture decision + data-leak footgun, not an optimization. Belongs in its own
  security-reviewed design doc, never bundled into a perf ticket.
- **P1/P3/P5/P6 (cache/prefetch/bundle-prefetch/optimistic)** — DEFERRED behind a hard
  re-measurement gate after Part 1. May be unnecessary once queries are entity-scoped
  (sub-100ms point-reads already feel instant on click).

### Failure modes registry (strategic)
| Risk | Trigger | Blast radius | Mitigation |
|------|---------|--------------|------------|
| Optimize the wrong axis | call-count vs payload-size never measured | weeks on the wrong fix | Phase 0 baseline |
| Instant-layer amplifies load | cache/prefetch added pre-scoping | steady-state WS load ↑ | gate Part 2 on re-measure |
| Whack-a-mole | per-query fixes leave waterfall intact | recurring findings | waterfall spike/ADR |
| Security DoS lingers in backlog | iCal scan filed as "perf" | cross-org scrape | ship #9 today, separately |

### Dream-state delta
12-month ideal = detail pages are pure Convex subscriptions (cross-domain user joins live
in Convex, no server-action waterfall). This plan optimizes *around* that waterfall. Gap:
the plan never sizes the replace-vs-optimize fork → added as a spike (taste decision T1).

### Auto-decisions (CEO)
| # | Decision | Class | Principle | Rationale |
|---|----------|-------|-----------|-----------|
| C1 | Add a Phase 0 measurement pass (Convex dashboard baseline + targets + exit criteria) before any code | Mechanical | P1, P6 | Both voices critical; cheap; settles the unproven premise |
| C2 | Ship iCal #9 immediately as an independent security fix, out of the perf queue | Mechanical | P6 | Externally-triggerable cross-org DoS; both voices agree |
| C3 | Add a sized spike: version-vector waterfall "narrow composites" vs "move joins into Convex" | Taste (T1) | P1 | Both want analysis not 1-line deferral; replace-vs-optimize is a real fork |
| C4 | Defer Part 2 (P1/P3/P5/P6) behind re-measurement; drop P4 from perf scope | USER CHALLENGE (U1) | — | User asked to ADD this; both models say cut/defer → not auto-decided |
| C5 | Promote getKit/getAsset scoping (#2) to Phase 1 IF any Part 2 work proceeds | Taste (T2) | P3 | Contingent on U1; both flag it as mis-sequenced keystone |

### ★ Premise gate resolved (user decision, 2026-06-26)
**User chose: "Adopt reframe — Part 1 first, gate Part 2."** Therefore:
- **U1 RESOLVED → DEFER Part 2.** The instant-feel layer (P1 cache, P3 prefetch, P5 bundle
  prefetch, P6 optimistic) is deferred behind a re-measurement gate after Part 1 lands.
  **P4 (SSR preload / per-user-JWT) is DROPPED** from this effort → its own security doc.
- **T2 RESOLVED → PROMOTE.** With Part 2 deferred, `getKit`/`getAsset` scoping is a pure
  backend efficiency win (kills the 2× whole-org refetch per detail edit) → moves to Phase 1.
- **C1 → Phase 0 measurement** added as the first step. **C2 → iCal #9** ships today,
  independently. **T1 (waterfall spike)** carried to the final gate.
- The sequencing below is rewritten to match. Phase 2 (Design) now reviews only the
  surviving UI surface: the `loading.tsx` skeleton states.

## Phase 2 — Design Review (skeleton/loading-state UX)

Voices: Claude independent design subagent. `[codex-design: skipped — proportionality; the
surviving UI surface is one skeleton pattern, not worth a second 10-min model run.]`

**Litmus scorecard (loading-state design):** initial **4/10** → **8/10** after the P2
corrections above are applied.

| Dimension | Score | Note |
|-----------|-------|------|
| Right mental model (where data resolves) | 3→9 | `loading.tsx` covers route/JS gap only; real wait is in-component (corrected) |
| Reuse / design-system alignment | 9 | Compliant kit already exists; mandate reuse, no shimmer |
| Layout-shift (CLS) | 4→8 | Per-route dimension match required; generic skeleton would shift |
| Skeleton vs spinner fit per route | 5→8 | Warehouse downgraded to chrome-only + pulse |
| State matrix (loading/empty/error/partial) | 2→7 | DESIGN §8 requires Error/Empty; `error.tsx` named as gap |
| Flash honesty (sub-200ms) | 3→8 | delay-before-show + min-display guard added |

**Auto-decisions (Design) — all P5 (explicit) / P4 (DRY) / P1 (completeness), no taste calls:**
| # | Decision | Class | Principle |
|---|----------|-------|-----------|
| D1 | Correct the mental model: audit in-component `isLoading` first; match or skip `loading.tsx` to avoid double flash | Mechanical | P5 |
| D2 | Reuse existing `skeleton.tsx` kit; no bespoke/shimmer | Mechanical | P4 |
| D3 | Per-route CLS dimension match; tailor the generic detail skeleton | Mechanical | P5 |
| D4 | Warehouse = chrome-only skeleton + pulse, not full structural | Mechanical | P5 |
| D5 | Add flash guard (delay-before-show + min-display) | Mechanical | P1 |
| D6 | Name `error.tsx`/empty per route as required state (DESIGN §8), even if `error.tsx` deferred | Mechanical | P1 |

No design taste decisions to surface — every finding had one clearly-correct fix.

## Phase 3 — Eng Review (architecture, tests, deployment)

Voices: Claude independent eng subagent + Codex (claim-verification). **6/6 dimensions
CONFIRMED**; both independently caught the same plan errors (high-confidence signal).

### Architecture: getKit current vs scoped (ASCII)
```
CURRENT getKit(id) — O(entire org inventory)            SCOPED getKit(id) — O(kit contents)
  getKitById(id)              point-read ✓                 getKitById(id)             point-read
  getKitSerializedItemsByOrg  ALL ser-items ─filter        kitSerializedItems.listByKitId   NEW q
  getKitBulkItemsByOrg        ALL bulk-items ─filter        kitBulkItems.listByKitId         NEW q
  getAssetsByOrg          ◀── WHOLE REGISTRY               assets.listByIds(memberIds)      NEW q
  getBulkAssetsByOrg          ALL bulk assets              bulkAssets.listByIds(memberIds)  NEW q
  getModelMap                 ALL models                   models by distinct member ids (or keep)
  lineItems + getProjectsByOrg ◀── ALL projects (×2)       lineItems + projects.listByIds
  assetScanLogs.list(org)     ALL scan logs ─filter        assetScanLogs.listByKitId  NEW q (idx exists)
  getMaintenanceRecordsByOrg  ALL maint ─filter            maintenance by kit/asset id
  + getLocationMap/getCategoryMap (whole tables for 1 FK)  location/category getById(fk)
```

### Verified findings (both voices)
1. **#2 under-scoped → CONFIRMED.** Not "read by id" — needs ~4 new `requireOrgRead`-scoped
   queries (`listByKitId` ×2, `listByIds` ×2) + a kit-scan-log query. `getAsset`'s
   `getMaintenanceRecordsByOrg` is the wasteful half (links already id-scoped). *Plan
   corrected; ship queries additively first, parity-test before rewire.*
2. **#5 overstated → CONFIRMED.** Index helps 1 site (`checkInBulkTotals:645`), not 5.
   *Plan corrected.*
3. **#1 pagination is an architecture decision, not mechanical → CONFIRMED.** Asset-table
   filters on cross-table `model.name` (search + sort), `model.categoryId`, and a `tags`
   array — none map to a Convex index (no `searchIndex` on assets). Partial-page client
   filtering ⇒ **silently wrong results**; page-local sort on joined fields ⇒ wrong order.
   A server-action `getAssets()` already does server-side filter/sort/paginate (but over a
   whole-org `.collect()`). → **Taste decision T3 (below).**
4. **#6(b) nested-kit cascade ZERO coverage → CONFIRMED.** Ship-blocked on T-A/T-B.

### Test diagram + plan
Written to disk: `~/.gstack/projects/gearflow/jayden-<branch>-test-plan-*.md`. 5 ship-blocker
tests (T-A nested-kit round-trip, T-B force-return, T-C/T-D getKit/getAsset parity, T-E iCal),
3 pagination-correctness tests (T-F/G/H), 1 index parity (T-I). Regression net already covers
`checkoutItems`/`checkinItems`/`checkInBulkTotals` via live-dev integration tests.

### Failure modes (eng)
| Risk | Severity | Gate |
|------|----------|------|
| Blind refactor of untested nested-kit cascade changes final location | HIGH | T-A/T-B ship-blocker |
| Scoped getKit/getAsset drops a member/lineItem silently | HIGH | T-C/T-D parity test |
| New by-id queries miss `requireOrgRead` → cross-org read hole | HIGH | auth review on each new query |
| Half-migrated pagination returns wrong filtered/searched results | HIGH | T3 decision + T-F/G/H |
| Index used before deployed | MED | index+code one commit |

### Auto-decisions (Eng)
| # | Decision | Class | Principle |
|---|----------|-------|-----------|
| E1 | Correct #5 claim to one site | Mechanical | P5 |
| E2 | #2 = new additive auth-scoped queries first, then rewire | Mechanical | P1,P5 |
| E3 | Split #6 into (a) safe pre-mutation dedup, (b) test-gated nested-kit consolidation | Mechanical | P5 |
| E4 | Add 9 tests; 5 are ship-blockers | Mechanical | P1 |
| E5 | Index + consuming code in one commit | Mechanical | P3 |
| E6 | Pagination filter/sort routing = architecture fork | Taste (T3) | — |

## Final gate — APPROVED (2026-06-26)

Taste decisions resolved by user:
- **T1 → Add the waterfall spike** (early, alongside Phase 0–1). Replace-vs-optimize is a
  live candidate; gate the #2 query build on its result.
- **T3 → Denormalize + searchIndex** for asset-list pagination (keep views reactive +
  correct; accept the one denormalization-mirror maintenance surface, with a sync test).
- (U1 deferred Part 2, T2 promoted #2 — resolved at the premise gate.)

**Status: plan APPROVED with the above incorporated.** Net shape: measure → security hotfix
(#9) → spike (T1) + scoped backend fixes (#2 as additive queries, #3, #5 [one site], #6
split) → paginate via denormalize+searchIndex (T3) → trim fan-out → ship + skeletons →
re-measure gate → (deferred) instant-feel. Ship-blocker tests T-A…T-E enforced. P4 dropped.


