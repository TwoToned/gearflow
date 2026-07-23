# Performance Deep-Dive: Why the App Is Slow & Chatty (June 2026)

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

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

---

# Phase 0 — Measured Baseline (real prod data, 2026-07, org has 2 users)

**Status of Phase 0.5:** #9 (`getByIcalToken`) already uses `.withIndex("by_icalToken", …)`
in the current tree (`convex/crewMembers.ts:50-58`) — the security hotfix has shipped.
Nothing to do there.

Convex dashboard, current month, org has **2 active users** and "pretty small usage":

| Resource | Value |
|---|---|
| Function calls | 266K |
| Database I/O | **6.05 GB** |
| Action compute | 0.00091 GB-hours |
| Database storage | 131.75 MB |

**This overturns the plan's priority order.** One function accounts for **4.66 GB of the
6.05 GB total (77%)** — more than 10× the next-largest contributor, and more than every
Tier-1/Tier-2 finding above combined. It wasn't named in the original findings because it's
a newer Convex-native composite (`convex/overbooking.ts`) that post-dates the audit's
initial pass. It becomes **Finding #0 — highest priority, ahead of #1-#9.**

### Finding #0 (NEW, CRITICAL): `overbooking.bundle` — unbounded all-time `by_modelId` scan, live-reactive

`convex/overbooking.ts:26` — for every model id in scope, `.withIndex("by_modelId", …)
.collect()` against `projectLineItems` with **no date or status bound at the query layer**.
The docstring (`overbooking.ts:6-12,35-40`) correctly notes an *earlier* version of this bug
was fixed — it used to `.collect()` the whole `projects`/`models` tables — but the
`projectLineItems` read itself is still unbounded: it returns **every line item ever booked
against that model, across every project, for all of history**, not just projects whose
rental window overlaps the one being viewed. The date-window filter
(`sumBookingsByModel` → `projectMatchesWindow`, `src/lib/overbooking-core.ts:119-125,154-160`)
only runs **after** the fetch, in JS.

Two things compound this into the dominant cost:
1. **No time bound at the index level.** `projectLineItems.by_modelId` has no
   `status`/date component (mirrors the schema gap already noted in Finding #5 for
   `by_projectId`). A model that's been booked across dozens of historical
   (CANCELLED/RETURNED/COMPLETED/INVOICED) projects pays for all of them, every time,
   forever — this scan only gets *more* expensive as the org's history grows. It is
   the same shape as Finding #8 (`swapLineItemAsset` full org-project scan for a
   date-overlap check) but on the hotter path and with no bound at all (not even
   "whole org," but "whole org history").
2. **It's a live `useQuery` subscription** (`src/hooks/use-native-project-equipment.ts:84-90`,
   `src/hooks/use-native-equipment-tab.ts:87-93`), mounted once per open project-detail /
   equipment-tab view, keyed on that project's referenced model ids. Any write to
   `projectLineItems`/`assets`/`bulkAssets` for a shared model — from **any project, any
   user, anywhere in the org** — re-triggers the full unbounded re-scan for every other open
   viewer subscribed to that model. With 2 users this already produced 19K calls / 4.66 GB
   this month; it scales with (org history size) × (concurrent viewers) × (write rate on
   shared models), not with the 2-user workload.

*Fix (two parts, can ship independently):*
- **Bound the query, not just the JS filter.** The cheapest correct bound: line items whose
  parent *project* is one of the excluded terminal statuses
  (`EXCLUDED_PROJECT_STATUSES` — CANCELLED/RETURNED/COMPLETED/INVOICED) are dead weight for
  every future read of that model, forever — they only ever get read and thrown away by
  `projectMatchesWindow`. That's a status stored on `projects`, not `projectLineItems`, so a
  composite index can't filter it directly without denormalizing project status (or the
  rental window) onto the line item, mirroring the T3 pagination decision (denormalize +
  index) already accepted elsewhere in this doc. Cheapest first cut: denormalize
  `projectStatus` onto `projectLineItems` (mirror on project status change, same shape as the
  T3 sync path) and add `by_modelId_projectStatus`, so terminal-status bookings never come
  off disk. This shrinks the candidate set for any org with real history, without touching
  the date-window math (still correct, still done in JS on the smaller set).
- **Reconsider live-reactivity for this composite.** Overbooking status doesn't need to
  update on writes to *unrelated* projects sharing a model in real time — a coarser
  invalidation (or converting to a one-shot fetch refreshed on the same version-vector tick
  as the rest of project detail, per the Tier-1 #3 "double refetch" fix) would cut the
  fan-out multiplier without touching the read shape.
- Ship-blocker: a parity test asserting `reconstructOverbookedStatus` output is unchanged
  before/after adding the status bound (same shape as T-C/T-D for #2).

### Finding #0b (confirms existing pattern, adds evidence): `projectLineItems.list` whole-org collect, called from scheduled/server code

`convex/projectLineItems.ts:23-32` — `.withIndex("by_organizationId", …).collect()`, the
same whole-org-collect shape as Finding #1, but this call site isn't a browser subscription —
it's called from **`src/server/notification-email-sender.ts:298`,
`src/server/notifications.ts:235`, and `src/lib/line-item-count-read.ts:29`**, i.e. scheduled/
cron notification code re-reading every line item in the org on each run. 3.9K calls / 371.64
MB this month (2nd-largest DB I/O consumer after #0) — confirms the "whole-org `.collect()`"
pattern isn't confined to list-page UI as originally scoped; it also costs on the batch side.
*Fix:* scope the notification scan to what it actually iterates (by project/date-range, not
whole org) — same remedy family as Finding #1, different call site to convert.

### Re-prioritized fix order (Phase 1, given real numbers)

1. **Finding #0** (`overbooking.bundle` status bound) — 77% of measured I/O, ship first.
2. Existing Finding #2 (`getKit`/`getAsset` scoping) and Finding #1 (asset-list pagination) —
   unchanged rationale, now confirmed second-order by volume (assets.create/remove,
   models.list, assets.list all appear mid-table but nowhere near #0's magnitude).
3. Finding #0b (notification scan scoping) — cheap, same shape as #1, bundle into that work.
4. Rest of Tier-1/Tier-2 as previously sequenced.

**Everything else in the original Phase 0 plan (spike T1, #2 additive queries, #5 index,
#6 split, T-A…T-I tests) still stands** — this section only re-orders by measured impact and
adds two findings the original static-analysis pass couldn't see because `overbooking.bundle`
postdates it.

### Finding #0 — SHIPPED (this session)

`convex/overbooking.ts` `bundle` now takes optional `thisProjectId` /
`rentalStartDate` / `rentalEndDate` args. When present (the new callers), it range-scans
`projects.by_organizationId_rentalStartDate` for the small set of projects overlapping the
viewed project's window (the same overlap pattern `swapLineItemAsset` already uses,
`convex/projectLineItems.ts:789-800`), excludes `CANCELLED`/`RETURNED`/`COMPLETED`/`INVOICED`
projects up front, then reads line items **per candidate project** via the existing
`by_projectId` index — instead of an unbounded all-time `by_modelId` scan across every project
that has ever booked the model. **No schema/index changes needed** — both
`projectLineItems.by_projectId` and `projects.by_organizationId_rentalStartDate` already
existed. Args are optional (expand-contract) so a caller still on the previous app build
during a deploy window falls back to the old unscoped-but-correct path unchanged.

Updated callers (same commit, per the doc's own "index + consuming code together" rule):
`src/lib/availability.ts` (`computeOverbookedStatus`), `src/hooks/use-native-project-equipment.ts`
(`useNativeProjectDetail`), `src/hooks/use-native-equipment-tab.ts` (`useNativeEquipmentTab`).

Ship-blocker parity test added: `convex/overbooking.test.ts` — asserts
`reconstructOverbookedStatus` output is byte-identical between the scoped and unscoped paths
over a fixture with an overlapping booking (counts), a cancelled-but-date-overlapping project
(must not count), a non-overlapping project (must not count), and a 400-day-old returned
project on the same popular model (must not count, and must not even reach the scoped
candidate walk) — plus an over-capacity regression check and a dateless-project case (scopes
to zero org-wide reads). 4/4 new tests pass; full existing suite (3242 tests) unaffected.

**Not yet done (deferred, needs a live deployment to verify against real numbers):**
push to a Convex deployment, re-measure `overbooking.bundle`'s Database I/O against this
month's 4.66 GB baseline, and confirm the drop. This worktree had no `.env` / deploy key
configured, so the change is unverified against a live deployment — do that before/as part of
the next deploy. Also deferred: reconsidering the subscription's live-reactivity (still
re-runs on any write to a shared model within the candidate window across all open viewers) —
noted as a follow-up in the original finding, not addressed by this scoping fix.

---

# Full re-audit against current `main` + official `convex-demos` patterns (2026-07-17)

A lot has changed in this codebase since the original findings/Eng review were written —
independent of this perf effort (the Convex-native browser-direct migration, per project
memory, hit a major milestone the same day this session ran). Re-checked **every** remaining
finding against the current tree, and cross-referenced the still-open ones against
[get-convex/convex-demos](https://github.com/get-convex/convex-demos) (`pagination`, `search`,
`presence-facepile`) for the canonical Convex pattern.

## Findings that are now OBSOLETE (architecture they were about no longer exists)

- **#2 (`getKit`/`getAsset` whole-org composites).** `src/server/kits.ts` and
  `src/server/assets.ts` **don't exist anymore.** The "replace, don't scope" side of the T1
  spike won: kit/asset detail now reads through the native browser-direct hooks
  (`use-native-*`), not a server-action composite. Nothing to scope — the thing being scoped
  is gone.
- **#3 (double refetch via the version-vector waterfall) / the T1 spike's premise.**
  `src/hooks/use-reactive-server-query.ts` **doesn't exist anymore** — zero references
  anywhere in `src`. The whole "Convex push → detect change → second server roundtrip →
  full Prisma composite re-read" architecture this finding and the T1 spike were about has
  been deleted, not narrowed. Confirms the same T1 outcome as #2.

## Findings CONFIRMED FIXED (verified against current source, not re-fixed this session)

- **#5 (`projectLineItems.by_projectId_status` index).** Exists (`convex/schema.ts:949`) and
  `checkInBulkTotals` uses it (`convex/warehouseOps.ts:1542`). Done.
- **#6(a) (`checkoutItems` pre-mutation dedup).** `gatherTestTagAssetsAndAssert` caches each
  line's units in a `Map` that `expandPrepUnitAssignments` reuses instead of re-reading —
  exactly the fix prescribed, with an inline comment documenting the safety invariant
  (`convex/warehouseOps.ts:181-238`). Done.
- **#8 (`swapLineItemAsset` full org-project scan).** Already uses the
  `by_organizationId_rentalStartDate` range-scan + JS overlap check
  (`convex/projectLineItems.ts:789-800`) — the exact pattern reused for Finding #0 this
  session. Done (found while building #0's fix).
- **#9 (`getByIcalToken` full scan).** Uses `.withIndex("by_icalToken", …)`
  (`convex/crewMembers.ts:50-58`). Done.

## Findings STILL OPEN — cross-referenced against convex-demos

**#1. List pagination (asset-table + friends) — still whole-org, but the hard part is already
half-built.** `asset-table.tsx` still mounts 5 whole-org live subscriptions
(`useAssets`/`useBulkAssets`/`useModels`/`useLocations`/`useCategories`,
`src/components/assets/asset-table.tsx:15,16,19,20`). There's also now a NEWER
`assets.listPage` query (`convex/assets.ts:54-100`+) built for a picker — but it still
`.collect()`s the whole org for assets/models/categories/locations and filters/sorts/paginates
**in JS**, same anti-pattern, just server-side instead of client-side. **However:** the schema
already has real search indexes on `models`/`assets` — `search_name` /`search_manufacturer`/
`search_assetTag`, each with `filterFields: ["organizationId", "isActive", …]`
(`convex/schema.ts:336,341,367,556,560`). This is exactly what T3 (denormalize + searchIndex)
needed, and it's already there. The `convex-demos/search` demo confirms the pattern:
`.withSearchIndex("search_body", q => q.search(field, term)).take(n)` — and Convex search
indexes support `.paginate()` too, so search + pagination compose in one query. **Gap is
narrower than the doc assumed**: the client wiring (asset-table → paginated/search query) is
the missing piece, not the search infra. Convex's own `pagination` demo pattern
(`paginationOptsValidator` arg + `.paginate(args.paginationOpts)` + client
`usePaginatedQuery`) is the mechanism to use for the non-search-filtered path.

**#4. Project-detail fan-out — still separate subscriptions, not collapsed.**
`equipment-tab.tsx` fires `api.collaboration.listLocksForEntity` and
`api.collaboration.listThreadCommentCounts` as separate `useAuthedQuery` calls
(`equipment-tab.tsx:137-144`); `use-collaboration.ts` separately subscribes to
`listPresence` (`:100-101`) and `getLock` (`:237-238`). Still ~4-5 live subscriptions per
page, not one composite. **Cross-check against convex-demos:** the per-entity reads
themselves are fine — `listPresence`/`listLocksForEntity` are scoped to one entity (bounded by
concurrent viewers of *this* page, not org history), which already matches the
`presence-facepile` demo's shape (indexed lookup, small result set). The finding here is
purely about **subscription count**, not unbounded reads — no demo directly shows "collapse N
queries into one," but it's the same composite-query pattern already used elsewhere in this
codebase (`equipmentTab.bundle`, `projectDetail.bundle`). Worth adding a defensive `.take(n)`
cap to `listPresence`/`listLocksForEntity` regardless (the demo's `LIST_LIMIT = 20` pattern) —
currently no cap, relying on "one page's viewers/locks is naturally small."

**#6(b). Nested-kit `setAssetsStatus` consolidation — still not attempted, but the
ship-blocking test gap may have closed.** The original finding said "ZERO test coverage" for
`checkoutKit`/`checkinKit`/`forceReturnKit`. `convex/kitPerUnit.test.ts` now has tests for all
three, including `"forceReturnKit returns the member's accessory (no stuck asset)"`. **Not
verified whether these specifically cover a kit-within-kit / overlapping-set final-state
assertion** (the exact race the original finding was worried about) — re-check before treating
this as unblocked.

**#7. Unbounded check-record reads — still unbounded, but may be dead code.**
`checkRecords.ts:53` `listRecentByAssetAndCheckItem` still `.collect()`s an asset's entire
check history and filters/sorts/slices in JS. **New finding: it has zero live callers** —
only a comment reference in `checkPredictiveMaintenanceCore.ts:54` ("mirrors
`listRecentByAssetAndCheckItem`"), meaning the real logic was likely reimplemented inline
there rather than calling this function. If confirmed dead, delete it rather than fix it.
`listByOrgAndAsset` (`:40`, also unbounded) DOES have a live caller
(`src/lib/check-record-read.ts:119`) — check whether that caller needs full history or would
tolerate a bound before assuming it needs the fix from the original finding. The
`presence-facepile` demo's `list` query (`by_room_updated` index + `.order("desc").take(20)`)
is the exact template if a bound turns out to be correct here.

## Findings resolved this session (2026-07-17, continued)

- **#7.** `checkRecords.listRecentByAssetAndCheckItem` deleted — confirmed zero live callers,
  `checkPredictiveMaintenanceCore.ts` reimplements the same lookup inline.
- **#4.** `LineItemRow` no longer mounts its own `getLock`/`getReviewMarker` subscription per
  row (2N un-dedupeable subscriptions for N line items — the actual mechanism behind
  `collaboration.getLock`/`getReviewMarker`'s disproportionate call counts, 9.6K/9.1K this
  month on a 2-user org). `equipment-tab.tsx` now fetches both project-wide, once, via the
  already-existing `listLocksForEntity`/`listReviewMarkersForEntity` queries (the
  `by target key` lookup pattern `src/lib/collaboration-targets.ts` documents was already
  half-applied to section/group locks — this finishes it for line items and extends it to
  review markers).
- **#6(b) — REASSESSED, no longer applicable.** Read the current `checkoutKitCore` /
  `checkinKitCore` / `forceReturnKitCore` (`convex/warehouseOps.ts`) in full: each calls
  `setAssetsStatus` exactly once for a kit's direct members' assets, plus once per nested kit
  for that nested kit's members' assets — disjoint sets (a `projectLineItem.assetId` can only
  belong to one line), not the "~6× over overlapping sets, last-write-wins" pattern the
  original finding described. That pattern must have been refactored away by other work
  independent of this perf effort (consistent with #2/#3/#5/#6a/#8/#9 all having shifted).
  No consolidation needed — nothing unsafe or wasteful left here.

## Finding #1 — SHIPPED (this session, `asset-table.tsx` only)

`src/components/assets/asset-table.tsx` now calls `assets.listPage` / `bulkAssets.listPage`
(server-side filter/sort/paginate, resolving model/category/location — already existed for
the T&T-new picker) via `useAuthedQuery` instead of mounting `useAssets`/`useBulkAssets`/
`useModels` as whole-org live subscriptions and filtering/sorting/paginating in the browser.
`useLocations`/`useCategories` stay (small, org-config-sized — needed for filter dropdown
option lists, not per-row data, so not the anti-pattern). Search is debounced 200ms
(`useDebouncedValue`) since each keystroke is now a real round-trip, not a free client-side
filter. Added `asset-table.smoke.test.tsx` (zero prior coverage on this component).

**`asset-gallery.tsx` — SHIPPED (Option A, this session).** User chose to keep the gallery's
"show everything, grouped by category" UX rather than add infinite-scroll (that was the other
option — bounds the read for real, but breaks category counts mid-scroll and is a bigger
change to a live feature). Added `assets.listGallery` — same read shape as before (every
active asset; that's the feature, not a bug), but ONE server-side query doing the model/
category/location joins and search filtering, replacing the 4 whole-org subscriptions
(`useAssets`/`useModels`/`useLocations`/`useCategories`) the gallery used to mount and join
client-side. Search debounced 200ms. `convex/assets.test.ts` added (zero prior coverage on
this file — covers `listGallery`'s filter/sort/join + cross-org isolation).

Residual, deliberately accepted: `listGallery` still reads every active asset in the org in
one `.collect()` server-side — this is the feature ("browse everything"), not a leftover bug,
but it means this query still carries the same Convex `.collect()` size-ceiling risk the
design doc flags generally for large orgs (see "Convex limits & risks"). If the org's active
asset count grows large enough to matter, infinite-scroll becomes the real fix — revisit then.

## Not re-checked this pass (lower priority / unaffected by the above)

Tier 3 items (`useCrewRoles` double-subscribe — confirmed still present,
`services-panel.tsx:1242` / `crew-panel.tsx:922`, doc already called it minor since Convex
shares the socket) and the `warehouse/page.tsx` 100-project roundtrip candidate weren't
re-verified against current source this pass.

---

# Follow-up audit: the rest of the app's entity lists (2026-07-17, same day)

After shipping the asset-list fix, a targeted sweep asked "does this same pattern exist
anywhere else?" Answer: **yes, on nearly every other entity registry in the app** — each
had its own hand-rolled whole-org-subscribe + client-side-filter/sort/paginate table,
independent of the asset one. Grep sweep (checked every `use<Entity>(orgId)`-shaped hook's
call sites, and separately checked for the *other* anti-pattern — a `useAuthedQuery` call
inside a per-row/per-card component instead of one page-level subscription passed down as
props — found none beyond the already-fixed `LineItemRow`; `project-board.tsx`'s cards and
`activity-feed.tsx`'s rows both correctly take data as props).

**Decision: build the shared pattern once, then apply it to every surface**, rather than
hand-rolling the fix a 5th–9th time. Two shared modules:

- **`convex/lib/listQuery.ts`** (backend) — `matchesSearch` (case-insensitive substring
  match), `compareValues` (null-safe, type-aware comparator — null sorts as the maximum
  value, consistent within a direction), `paginateItems` (slice + pagination metadata).
  Pure, unit-tested (`convex/lib/listQuery.test.ts`). Each table still gets its OWN
  `listPage`/`listGallery`/`listBoard` query — Convex needs the literal table name and
  every entity has different filter dimensions/joins — but the sort/search/paginate
  boilerplate is now one shared, tested implementation instead of a copy per file.
  `assets.ts`/`bulkAssets.ts` were retrofitted onto it (behavior unchanged, all existing
  tests still pass) before extending to the new surfaces.
- **`src/hooks/use-paginated-table-result.ts`** (frontend) — derives
  `{data, total, totalPages, isLoading}` from a `listPage`-shaped Convex query result.
  Every new query standardizes on `{items, total, page, pageSize, totalPages}` so no
  per-call adapter is needed (the two legacy queries, `assets.listPage`/`bulkAssets.listPage`,
  keep their existing `assets`/`bulkAssets` field names for back-compat with the T&T-picker
  consumer and weren't retrofitted onto the new hook — wrapping them would've added glue
  code for no benefit).

## Fixed this pass (all shipped, tested, typechecked, linted clean)

**Paginated tables** (5 new + assets already done = 6 total registries now server-paginated):

| Table | Old subscriptions | New query | Notable tradeoff |
|---|---|---|---|
| `project-table.tsx` | `useProjects`+`useClients`+`useLocations` | `projects.listPage` | none |
| `kits/page.tsx` | `useKits`+`useCategories`+`useLocations` | `kits.listPage` | none |
| `crew-table.tsx` | `useCrewMembers`+`useCrewRoles` | `crewMembers.listPage` | search no longer matches the linked platform user's display name (Better Auth, cross-domain — can't join it in Convex); `icalToken` redaction for non-service callers carries over (tested) |
| `client-table.tsx` | `useClients` | `clients.listPage` | none |
| `supplier-table.tsx` | `useSuppliers` | `suppliers.listPage` | tag search became case-insensitive (was a pre-existing inconsistency vs. every other field, incidentally fixed by using the shared matcher) |

**Unpaginated "browse everything, grouped" views** (Option A, same shape as the asset
gallery):

| View | Old subscriptions | New query |
|---|---|---|
| `project-board.tsx` (kanban) | `useProjects`+`useClients` | `projects.listBoard` |

Each ships with: a Convex-level test file (all previously had **zero** test coverage —
`convex/projects.test.ts`, `convex/kits.test.ts`, `convex/crewMembers.test.ts`,
`convex/clients.test.ts`, `convex/suppliers.test.ts`) covering filter/sort/join/search/
cross-org-isolation, and a component-level smoke test pinning that the table/board renders
off a `listPage`/`listBoard`-shaped result and that search is debounced (200ms,
`useDebouncedValue`) instead of firing a query per keystroke.

## Explicitly NOT fixed this pass — flagged, not silently skipped

**`clients-dashboard.tsx`'s `useProjects` call.** Different problem shape from everything
above: it's not rendering a list of rows, it's computing **aggregate stats** (revenue/project
counts for one client) by pulling the whole org's projects into the browser and reducing
client-side. The right fix is a server-side sum/count query scoped to that one client
(`projects.by_clientId` index already exists), not a paginated list — genuinely different
work, not a mechanical application of this session's pattern. Left as a named follow-up.

## Honest limits of this round

- **Read shape didn't change for the unpaginated views** (`asset-gallery.tsx`,
  `project-board.tsx`) — they still `.collect()` every matching row server-side, because
  "show everything" is the actual feature. That's fine at today's scale but still carries
  the Convex `.collect()` size-ceiling risk for a large org; infinite-scroll is the real
  fix if/when that matters (see the asset-gallery section above for the tradeoff writeup).
- **None of this is verified against a live deployment.** Same caveat as Finding #0 and
  everything else in this doc — this worktree has no Convex deploy key configured. Deploy,
  then re-check the dashboard's per-function Database I/O for `projects.list`, `kits.list`,
  `crewMembers.list`, `clients.list`, `suppliers.list` (the OLD whole-org queries) — they
  should drop toward zero as traffic shifts to the new `listPage`/`listBoard` queries, with
  a corresponding drop in each list page's total Database I/O.


