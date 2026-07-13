<!-- /autoplan restore point: ~/.gstack/projects/gearflow/worktree-bridge-cse-autoplan-restore-20260712-194629.md -->
# Convex-Native — Full Build-on-Convex Plan

**Status:** Planning. Scope locked 12 Jul 2026. Nothing implemented here.
**Decision:** the app becomes **fully Convex-native**. Postgres runs **Better Auth only**. All domain data, activity log, RBAC roles, settings, and search move to Convex, accessed **browser → Convex directly**. Prisma is used only by the Better Auth adapter. The server-action data layer is deleted.
**This finishes + extends work already underway:** [`convex-domain-only-decommission.md`](./designs/convex-domain-only-decommission.md), [`convex-decommission-RUNBOOK.md`](./designs/convex-decommission-RUNBOOK.md), [`convex-hybrid-migration.md`](./designs/convex-hybrid-migration.md). Read those — this doc is the target + the two deltas on top of them, with the browser-direct execution standard from the `/autoplan` review.

---

## 1. End state (what "fully native" means here)

```
Postgres (tiny)                      Convex (everything else)
─────────────                        ────────────────────────
Better Auth ONLY:                    ALL domain data (9 core domains + every sub-table)
 user, session, account,             activityLog (audit)
 organization, member, verification, RBAC = built-in roles only, enforced in Convex
 invitation, jwks, twoFactor,          (owner/admin/manager/member/warehouse/viewer —
 backupCode, passkey, ssoProvider,      static matrix in permissionsCore.ts; customRole DROPPED)
 member.role (the role claim)        org business settings (tax rate, numbering, ...)
                                     search indexes (replaces pg_trgm)
                                     files: metadata + BYTES (Convex storage, S3 retired)
                                     WooCommerce/webhooks (Convex HTTP actions)
        │  mints ES256 JWT                     ▲
        │  (user, org, role claims)            │ browser → Convex DIRECTLY
        ▼                                       │  reads: useAuthedQuery
   one-way sync ─► Convex read-only mirror ─────┘  writes: useMutation
   of user/org/member (the ONLY Postgres→Convex sync that remains)
```

- **Reads:** `useAuthedQuery(api.*)` — browser subscribes to Convex over the socket (user JWT). No server action.
- **Writes:** `useMutation(api.*)` — browser calls the Convex mutation directly. Business logic (permission check, validation, activity log) lives **inside the mutation**, not a server action.
- **Prisma:** imported only by the Better Auth adapter. Every `prisma.<domainModel>` call is gone.
- **The auth bridge (stays — but it's tier-0, not "done").** Better Auth on Postgres mints the JWT; Convex validates it (`convex/auth.config.ts`) and keeps a **read-only mirror** of `user/org/member` synced from Postgres. **This mirror is the authorization source of truth:** `requireOrgPermission` (`convex/lib/auth.ts:185`) resolves the caller's role from the Convex `members` **mirror row**, not the JWT claim. Today the sync is **best-effort fire-and-forget** and the reconcile "backstop" referenced in `member-mirror.ts:24` **doesn't exist** — so it must be hardened before browser-direct (§6). This one-directional sync is the only Postgres↔Convex link left.

---

## 2. Where we already are (this is mostly finishing, not starting)

From the decommission runbook:
- **Phase A (reads → Convex): DONE** — all `feat/convex-read-*` merged to the integration branch; ~2400 vitest green.
- **Bucket 1 + Bucket 2: DONE** — availability/reservation reads on Convex; 6 zero-FK tables Convex-only.
- **Phase B (write-inversion): IN PROGRESS** — 17 surfaces already Convex-only + dev-validated.
- **Phase C (strip Prisma schema + DROP domain tables): not started.**
- Convex already mirrors 43+ tables; parity infra (`writeParity.test.ts`, `convex-parity-check.ts`) exists.

So the domain migration is real and moving. This plan adds three things to it: **(a)** two more inversions (customRole, activityLog) to reach "Better Auth only", **(b)** the browser-direct native layer, **(c)** rebuilding the Postgres-only capabilities (search) on Convex.

---

## 2b. Phase map (execution order)

The workstreams (§3) sequence into 5 phases. Each phase ships to prod incrementally; the irreversible step is isolated to the very end (Phase 4).

| Phase | Name | Contains | Exit gate | Effort |
|---|---|---|---|---|
| **0** | **Foundations & quick wins** | Prod backup export ✅ + **rehearsed restore drill**; Convex **observability** (dashboards/alerts/kill-switches); **auth-mirror reconcile + lag monitoring** (tier-0); **DB I/O efficiency batch #1** (overbooking dedupe+narrowing ✅ + the safe-now Appendix-B fixes) → **the overbooking fix ships here**; customRole safe-to-drop confirmed ✅ | backup restored in a drill; observability live; mirror monitored; I/O trending down | S–M |
| **1** | **Convex = source of truth** (finish WS1 decommission) | Finish Phase B write-inversion (remaining domains Convex-only, delete `*-mirror.ts`); **drop customRole**; **activityLog → Convex**; **org settings → Convex** → "Better Auth only" in code | per-domain parity clean; app runs with zero domain `prisma.*` | L |
| **2** | **Rebuild Postgres-only capabilities** (WS3) | **Global search → Convex**; availability Prisma-leak → Convex; reporting/analytics + **versioned whole-org export**; **files → Convex storage** (+ Garage/S3 byte backfill); **WooCommerce → HTTP actions** | search validated vs real queries; export validated; file byte parity | L (search = the big new build) |
| **3** | **Browser-direct native** (WS2) | **Security baseline** (actor identity, strict `v.*`, rate limiter, internal fns); per-domain two-hop (server-native → browser-direct), **optimistic-by-consequence**, **bulk array mutations** (Appendix A), **efficiency indexes/loops** (Appendix B remainder), notifications native subscription | security review; shadow-compare on money/inventory; bulk benchmarked | XL (the bulk of the work) |
| **4** | **Cutover & irreversible drop** | Strip Prisma domain models, **`DROP TABLE CASCADE`**, delete server-action layer + mirror + parity/backfill infra | **rehearsed restore passed**, org-wide parity clean, all WS3 done, soak — then the one-way door | M (mechanical, irreversible) |

**Prod is dark** for the duration → each phase merges to `main` and deploys via CI. The efficiency work (Phase 0 / Appendix B) is unblocked and independent — it doesn't wait on the migration.

---

## 3. Three workstreams

### WS1 — Finish source-of-truth inversion + drop Postgres domain
Follow the runbook. Complete Phase B (invert every remaining domain write to Convex-only, delete the `*-mirror.ts` sources), then Phase C (strip Prisma domain models, `DROP TABLE` the domain tables, delete backfill/parity infra). **Deltas beyond the existing plan** to hit "Better Auth only":
- **activityLog → Convex** (drop the Postgres audit table). Already mirrored via `activityLogWrites`; make Convex primary, delete the Postgres write.
- **customRole DROPPED; keep built-in roles only** (owner/admin/manager/member/warehouse/viewer). The pure permission matrix already lives in `convex/lib/permissionsCore.ts` and **already runs inside Convex** (`requireOrgPermission` reads `member.role` from the JWT claim). So RBAC *enforcement* is native with near-zero migration cost; deleting `customRole` removes the one RBAC piece that was Postgres-bound (its table, mirror, `parseCustomPermissions`, and the per-org role-matrix UI). RBAC *administration* (assigning a role) stays server-side because it writes the Better Auth `member.role` (see Decision 13). **Pre-req: confirm few/no orgs rely on custom roles before deleting** — if customers use them, this removes a feature.
- **Org business settings** (e.g. `organization.defaultTaxRate`, project-numbering format) → a Convex settings table, off the Better Auth `organization` row. The Better Auth org row keeps only auth fields.

### WS2 — Browser-direct native (delete the server-action data layer)
Move business logic **from server actions into Convex functions**, and wire the browser straight to Convex.
- **Reads:** flip the built-but-OFF `NEXT_PUBLIC_NATIVE_*` flags; convert the remaining "signal-only" reads (project services, crew scheduling, maintenance, supplier orders, saved views) to real native bundles; notifications poller → subscription.
- **Writes:** browser `useMutation(api.*)`. Two-hop rollout per domain using the existing flags — `NATIVE_*_WRITES` (server routes through the native mutation, no-rebuild rollback) baked first, then `NEXT_PUBLIC_NATIVE_*_OPTIMISTIC` (browser-direct). Parity-gated at each hop.
- **Security baseline — MANDATORY (the mutation is now the boundary; no server action in front):**
  - **Identity from `ctx.auth.getUserIdentity()`**, never a client arg. Add `resolveActor(ctx, supplied)`: user tokens get the verified identity; the currently-spoofable `actor` arg is overwritten. (This is the actor-spoofing hole — real, and now load-bearing.)
  - **Strict `v.*` arg validation + `returns` validators** on every public function (Convex rejects undeclared fields → clients can't smuggle data).
  - **Per-doc / per-item org re-check** on every row touched — `by_cuid`/`by_modelId` are global indexes; one missed `organizationId` check = cross-tenant read/write.
  - **`internal*` for anything not client-callable**; keep the public surface minimal.
  - **Rate Limiter component** (`@convex-dev/rate-limiter`) — replaces the throttling the server-action tier gave implicitly.
- **Optimistic by consequence** (not blanket): notes/status/reorder/tags → optimistic (`withOptimisticUpdate`); warehouse checkout/checkin, archive/delete, pricing, scheduling → explicit **pending → confirmed/failed**, never a fake success (rollback can't undo an operator handing out gear or a quote sent).
- **Bulk = native array mutations, per-action semantics:** warehouse/inventory bulk preserves **partial-success** (`{succeeded, errors}` — one bad item can't abort a 200-item deploy); atomic all-or-nothing only for genuinely transactional sets. **Benchmark sizing** (50/200/500/1000 × 1/4/8 concurrent) against Convex's 16k-write / 1s-CPU limits before trusting a per-call ceiling; chunk overflow via scheduler/Workpool. Per-item deterministic `auditId` for OCC-retry safety.
- **Single-call bulk invariant (enforced gate):** **every surface where a user can act on more than one item at once resolves to exactly ONE Convex array mutation** — no client fan-out, no server-side per-item Convex loop. This is a hard review gate: a domain does not ship native until each of its multi-select actions is a single array mutation. The complete audited inventory + the specific gaps to close are in the [Appendix](#appendix--bulk-single-call-guarantee-complete-multi-select-inventory).
- **End:** server actions deleted — **but EXEMPT the `src/lib/*-read.ts` service-read helpers** (`getConvexClient` service token, e.g. `projects-read.ts:10`). PDF/CSV run in Node and can't use browser `useQuery`; they read domain data through these helpers, so the seam must survive the server-layer deletion.

### WS3 — Rebuild the Postgres-only capabilities on Convex
These have no Convex equivalent yet and **must land before Phase C drops Postgres**:
- **Global search (the one real new build).** `src/server/search.ts` is Postgres `pg_trgm` weighted trigram across 13 entities (0 Convex refs). Rebuild on Convex: per-entity **search indexes** (BM25) queried in parallel and **federated + re-ranked** in one Convex query across the 13 types. Cross-entity ranking is approximate vs the hand-tuned trigram weights — acceptable for command-palette typeahead; validate against real queries. Blocks the Postgres drop (search breaks otherwise).
- **Availability / reservation-conflicts:** reads already Convex; strip the residual Prisma leak in `reservation-conflicts.ts` (the TOCTOU swap-guard) so the file is Convex-only.
- **Reporting / analytics / data-export (inventory, don't grep-and-hope).** `src/server/search.ts` is only the search slice; there's also ad-hoc reporting, finance reconciliation, and — critically — **whole-org data export** (account closure / portability / "give me my data"). Postgres SQL made these trivial; Convex (no joins, aggregate limits) does not. Catalogue every report + raw query now, classify each (Aggregate component / precomputed rollup / accept-degraded / keep on a read-path), and build a **versioned full-org export** (domain records + audit history + file manifest) that you can produce and independently validate. This is a late-surprise magnet — do it before the drop.
- **File storage → Convex (S3 retired).** Replace the `/api/uploads` Node route with the native 3-step flow: a mutation returns `storage.generateUploadUrl()` → browser POSTs bytes straight to Convex → a mutation persists `storageId` + metadata (org-scoped). All media types (asset/kit/model/client/location/project media, crew + user avatars) share this. Details to handle:
  - **Thumbnails:** currently server-side (`generateThumbnail`). Move to **client-side** (browser canvas resize before upload — upload full + thumb), or a Convex `"use node"` action triggered after upload. Client-side is cleanest (keeps it browser→Convex).
  - **Type/size validation:** the metadata mutation enforces declared MIME/size; add a `"use node"` verify action only if byte-sniffing is required.
  - **Private-file serving / org isolation:** serve through an **authed Convex query** that checks org then returns `storage.getUrl(storageId)` — don't hand raw storage URLs to the client for tenant-private media.
  - **Existing S3 media:** one-time **backfill** (download from S3 → `storage.store` → update `storageId`); dual-serve (old rows from S3) until backfilled, then retire S3.
- **WooCommerce / webhooks → Convex HTTP actions.** Replace the Next webhook route with a Convex **`httpAction`** at `…convex.site/webhooks/woo` that verifies the HMAC signature (secret in **Convex env vars**) and writes to Convex directly. Outbound Woo calls (product/order sync, webhook registration) become Convex **actions** (`fetch`, or `"use node"` for the Woo SDK). "Configure WooCommerce" (a user action) becomes a Convex mutation writing config + an action that registers the webhook. **Cutover:** re-register the webhook URL with WooCommerce (points at the new `.convex.site` endpoint); move secrets to Convex env. Validate signatures strictly — the endpoint is public.

---

## 4. Sequencing (the drop is irreversible — order matters)

Per domain, repeat: **invert write to Convex-only (WS1)** → **move business logic into the mutation + expose browser-direct behind flags (WS2)** → **parity test + soak** → next domain. Cross-cutting, before the drop: **build Convex search (WS3)**, invert **customRole / activityLog / settings**. Then, once *every* domain is Convex-only and parity is clean org-wide: **Phase C — strip Prisma domain schema + `DROP TABLE CASCADE`** (irreversible), then delete server actions, `*-mirror.ts`, and backfill/parity infra.

Use the runbook's execution model: single integration branch `integration/convex-decommission`, **prod OFF to users for the cutover window**, one Coolify deploy at the end preceded by the final prod backfill + parity check. Data-correctness validated by a human on the Coolify PR preview (the dev worktree can't run Convex/app). **This big-bang model is acceptable *because prod is dark / pre-launch for the duration*** (owner-confirmed). If prod goes live to customers before cutover, switch to per-domain incremental-live shipping — the `NATIVE_*` flags already support it.

**Suggested order:** finish Phase B leaf domains → customRole drop + activityLog + settings inversion → Convex search (WS3) → **files → Convex storage + WooCommerce → HTTP actions** (required, not optional) → browser-direct native per domain (WS2, kit/crew/project/line-item/asset/warehouse) → availability leak → reporting/export build → **Phase C drop** → delete server-action layer.

**Hard ordering gates — nothing proceeds past these:**
1. **Auth-mirror reconcile job + lag monitoring live** → before *any* domain goes browser-direct (the mirror is the authZ source).
2. **Observability + kill switches for the public mutation surface** → before browser-direct.
3. **Aggregate / sharded counters built + backfilled** → before flipping high-write domains browser-direct (pre-empt hot-row OCC contention, don't discover it in prod).
4. **Convex search validated against real query logs** → before the drop (search breaks otherwise).
5. **File dual-read (S3 + Convex) reconciled; S3 retired only after byte/hash/metadata parity** → before dropping file rows.
6. **WooCommerce httpAction validated + dual-accept across the URL swap** (old Next route still writes) → before retiring the old endpoint.
7. **Reporting + whole-org export built and validated** → before the drop.
8. **Convex backup export + a REHEARSED restore drill (measured RPO/RTO)** → the final hard gate before `DROP TABLE` (§6). No drilled restore, no drop.
9. **Prisma domain models removed only after every runtime, script, test, cron, and admin tool is free of domain-model calls** (keep `src/lib/*-read.ts`); **physical `DROP TABLE` only after** 8.

---

## 5. Native vs server — what happens when a user does something

**Fully Convex-native (browser → Convex directly, no server hop):**

| User action | Path |
|---|---|
| View any page (dashboard, projects, assets, kits, warehouse, crew, clients, suppliers) | `useAuthedQuery` → Convex (reactive) |
| Create / edit / delete any domain record | `useMutation` → Convex mutation (logic + RBAC check + audit in-mutation) |
| Bulk actions (deploy/return N assets or kits, pass N checks, bulk edit/delete, apply tags) | one native array mutation → Convex (partial-success) |
| Warehouse prep / deprep / checkout / checkin / close | native mutation → Convex |
| Edit notes / status / reorder / tags (optimistic) | `useMutation` + optimistic → Convex |
| Global search / command palette | Convex search index (after WS3) |
| Notifications | Convex subscription (no poller) |
| Activity log (read + write) | Convex |
| Permission checks (built-in roles) | enforced inside the Convex mutation (`member.role` from JWT) |
| **Upload a file / photo** | Convex `generateUploadUrl` — browser POSTs bytes straight to Convex (S3 retired) |
| **WooCommerce sync / incoming webhook** | Convex `httpAction` + actions (secrets in Convex env) |

**Still through the server (Next.js / Better Auth) — the short list:**

| User action | Why it stays server |
|---|---|
| Log in / out, sign up, reset password, SSO, passkey, 2FA, **switch org** | Better Auth flows — Postgres, mints the Convex JWT |
| Invite / remove a member, **change someone's role** | writes Better Auth `member` (RBAC *administration*, not enforcement) |
| **Generate a PDF** (docket, quote, report) | `@react-pdf` needs a Node runtime |
| **Export / import CSV** | Node file buffer generation / parsing (data still lands in Convex) |

That's the whole server surface: **Better Auth + two Node-bound compute tasks (PDF, CSV).** Both PDF and CSV *could* also move onto Convex as `"use node"` actions (making Next.js purely the frontend + auth) — not required, flagged as an option. The server-action **data** layer is deleted entirely.

---

## 6. Security, reliability & rollback

- **Browser-direct security baseline is mandatory** (WS2) — the mutation is the boundary once the browser calls it directly.
- **Auth mirror is tier-0 (it's the authZ source).** `requireOrgPermission` resolves the caller's role from the Convex `members` mirror row (`convex/lib/auth.ts:185`), not the JWT. Today the mirror is best-effort fire-and-forget (`user-mirror.ts:10-13`) and the referenced nightly reconcile **doesn't exist**. **Before any browser-direct domain:** build the reconcile job (periodic full (org,user) reconcile + drift alert), add sync-lag monitoring, keep the existing fail-closed revoke/demote ordering (Convex-first, strict). A lagging mirror = a real user silently mis-authorized.
- **Backup / restore is the ONLY recovery path** (you chose to drop at cutover, so there's no cold-table fallback). Convex becomes the sole copy of all business data **and file bytes**. **There is no backup mechanism in the repo today.** HARD GATE before `DROP TABLE`: scheduled Convex snapshot export to off-provider cold storage (data + storage bytes + metadata + a secrets inventory), and a **rehearsed full restore into a scratch deployment** with measured RPO/RTO. No drilled restore → no drop.
- **Rollback (corrected — the earlier claim was false):**
  - *Before a domain is inverted:* `NATIVE_*_WRITES` off → legacy path. Valid.
  - *After a domain is Convex-only* (the 17 already inverted + all future): Postgres is **abandoned for writes** (`warehouse-close.ts:156` "Convex-only since Phase C"); its table is a **stale frozen snapshot, not a flag-flip fallback.** Rollback here means **browser-direct → server-mediated Convex** (flip the optimistic flag), *not* Convex → Postgres. A real datastore rollback needs an explicit, tested Convex→Postgres reverse migration + maintenance window — don't assume it exists.
  - The `NATIVE_*_WRITES` flags only choose *where RBAC/audit run*; **both branches write domain data to Convex** (`native-writes.ts:4-27`).
  - Keep parity tests + `convex-parity-check.ts` per inversion, and **runtime shadow-compare** for money/inventory writes (warehouse, pricing, line-items) before flipping.
- **Observability / on-call (before browser-direct).** Error visibility moves from Next logs to Convex the moment the browser calls mutations directly. Wire Convex log streaming + dashboards (auth failures, cross-org attempts, mutation latency/error, OCC retries, webhook failures, scheduler backlog, rate-limit hits), per-mutation/domain kill switches, and an on-call runbook. Don't log sensitive/high-cardinality payloads.
- **After Phase C the drop is irreversible** — gated by the full ordering list in §4, with the rehearsed restore drill as the final gate.

---

## 7. Effort & risk

- **WS1** — finishing an in-flight effort. Bounded by the runbook. The customRole/activityLog/settings deltas are small (already mirrored).
- **WS2** — the largest sustained effort: business-logic-into-Convex + browser-direct per domain, with the security baseline. Domain-by-domain, flag-gated, reversible until the drop.
- **WS3** — **global search is the notable genuinely-new build**; the rest is leak-stripping + optional storage/webhooks.
- **Biggest de-risk:** keeping Better Auth on Postgres means the single hardest migration (auth off its Prisma adapter) is **explicitly out of scope**, which keeps the whole thing tractable.
- **Biggest risks (grounded in the review):** (1) **no backup/restore exists** and you're dropping at cutover — the rehearsed restore drill is the single most important gate (§6); (2) **the auth mirror is the authZ source but is best-effort with no reconcile** — build the reconcile before browser-direct (§6); (3) search ranking regression vs pg_trgm — validate before drop; (4) browser-direct security surface — the baseline is non-negotiable; (5) hot-row OCC contention at scale — Aggregate/Sharded Counter before high-write domains go direct; (6) reporting/whole-org export — inventory early, it's a late-surprise magnet.
- **De-risk from the owner's choices:** prod is dark/pre-launch → the big-bang cutover's blast radius is bounded (no live customers during the window). That's the main thing that makes drop-at-cutover tenable — it hinges on prod staying dark until cutover.

---

## Decision Audit Trail

| # | Decision | Rationale |
|---|---|---|
| 1–11 | (autoplan review — see git history) | CEO+Eng dual-voice; produced the security baseline, optimistic-by-consequence, partial-success bulk, benchmark, read-set-breadth bundling |
| 12 | **Full Convex-native, browser-direct.** Postgres = Better Auth only; server-action data layer deleted | User directive, overriding the review's wedge recommendation. User owns the Convex strategic bet |
| 13 | **Drop customRole; keep built-in roles.** activityLog → Convex | RBAC matrix already runs in Convex (`permissionsCore.ts`); dropping customRole removes the one Postgres-bound RBAC piece. **RE-SEQUENCED (12 Jul, after mapping): customRole is ~30 files entangled with the auth + SSO path (`sso-provisioning` maps SSO groups → custom roles), 0-usage → data-safe but rewires security-critical code for ZERO functional benefit. It's the highest-risk / lowest-urgency Phase-1 item → do it LAST in Phase 1 (or defer): it can sit on Postgres harmlessly meanwhile.** Slices when done: (A) remove write/management UI + `custom-roles.ts`, (B) remove SSO group→customRole mapping, (C) remove the `custom:` resolution branches, (D) drop Prisma `custom_role` + Convex `customRoles`. Each preview-tested (login + RBAC + SSO settings) with test creds. Enforcement native; role *assignment* stays server (Better Auth `member.role`) |
| 14 | **Global search rebuilt on Convex** (per-entity search indexes + federated re-rank) | pg_trgm is a Postgres feature; removing Postgres forces it. Must land before the drop |
| 15 | **Keep the review's execution standard** — browser-direct security baseline, optimistic-by-consequence, warehouse partial-success, benchmark-before-size | Valid regardless of transport; more important now that the mutation is the security boundary |
| 16 | Org business settings (tax rate, numbering) → Convex; Better Auth org row keeps auth fields only | "Better Auth only" on the org table |
| 17 | **Files → Convex storage (S3 retired).** Browser uploads via `generateUploadUrl`; thumbnails client-side; org-scoped serving via authed query; one-time S3→Convex byte backfill | User directive — files fully native, no Node upload route |
| 18 | **WooCommerce/webhooks → Convex HTTP actions + actions.** Secrets to Convex env; re-register webhook URL at `.convex.site` | User directive — integrations fully native, no Next webhook route |
| 19 | **Keep big-bang cutover** (prod OFF, integration branch, one deploy) | **User confirmed prod is dark/pre-launch** during the migration → blast radius bounded; incremental-live not needed. Revisit only if prod goes live before cutover |
| 20 | **Drop Postgres domain tables at cutover** (rejected the defer-drop option) | User choice. Consequence: no cold-table fallback → the rehearsed **restore drill is the mandatory recovery path** (Decision 21) |
| 21 | **Backup/restore + rehearsed restore drill = hard gate before DROP** (2nd autoplan finding, code-confirmed: no backup exists) | Convex becomes sole copy of data + file bytes; dropping at cutover with no drilled restore is the plan's top risk |
| 23 | **Single-call bulk invariant + complete inventory** (Appendix) — every multi-select surface = one Convex array mutation, enforced as a per-domain ship gate | User asked to guarantee bulk for *any* multi-item surface; exhaustive 4-pass sweep found 0 with no batch (Type C), ~8 client-fan-out gaps, and a set of server-loop conversions. No multi-select on clients/suppliers/locations/categories/tags |
| 22 | **Auth mirror hardened to tier-0 before browser-direct** — reconcile job + lag monitoring (code-confirmed: currently best-effort, reconcile is vaporware). Rewrote the false §6 rollback claim. Exempt `src/lib/*-read.ts` from server-layer deletion. Files/Woo = required gates not optional. Full ordering-gate list added | 2nd autoplan (CEO+Eng dual-voice, code-grounded); user approved applying all |

---

## Appendix — Bulk single-call guarantee (complete multi-select inventory)

Exhaustive sweep (4 cross-verified audit passes) of every surface where a user can act on >1 item. **Invariant:** each resolves to ONE Convex array mutation, enforced as a per-domain ship gate.

**Classes:** **A** = one client call → one atomic Convex array mutation (goal). **A\*** = one client round-trip but loops N Convex writes server-side (must become an array mutation for native). **B** = client fires N round-trips (must fix). **C** = multi-select UI with no batch at all.

**Type C (multi-select UI, no batch): NONE.** Every multi-select surface has at least a looped action — no silent gaps.

### Already single atomic array mutation (Class A) — keep
Assets bulk-edit + force-return; **all line-item bulk** (delete/edit/move + all reorders); crew bulk-delete/bulk-status + log-time-for-many; project-managers; services bulk-delete/status + multi-crew add; tasks bulk update/delete; **all non-kit warehouse item paths** (deploy/return/prep/deprep/undeploy/unreturn) + batch project close-out; kit member add; API bulk-checkin; permission-map save; media/custom-field reorders; maintenance multi-asset (asset holds); comment mentions.

### Fix: client fan-out, N round-trips (Class B)
| Surface | File | Fix |
|---|---|---|
| ~~`/kits` bulk force-return~~ **DONE** | `kits/page.tsx` | `forceReturnKitsBatch` array mutation (partial-success + per-item org re-check) + `forceReturnKits` server action; page calls it once |
| Warehouse prep **kits** | `warehouse/[projectId]/page.tsx:1804` | `prepKitsBatch` |
| Warehouse undeploy **kits** | `page.tsx:864` | `undeployKitsBatch` |
| Warehouse unreturn **kits** | `page.tsx:853` | `unreturnKitsBatch` |
| Kit-verify "Prep Verified" | `page.tsx:2747` `map(prepItemDirect)` | use existing `prepItemsBatch` (trivial) |
| Container-sync | `page.tsx:689/705` | `syncContainersBatch` (secondary) |
| Multi-file media upload | `media-uploader.tsx:183` | batch the `addMedia` **link** step (`addManyMedia`); file bytes stay per-file (per §WS3, direct-to-Convex `generateUploadUrl`) |
| Maintenance/damage photo grid | `photo-grid-input.tsx:110` | same — batch the link step |

### Convert: one round-trip but server-loops (Class A\*) → array mutation
~~Model set-rates (`models.ts:485`)~~ **DONE** (`models.bulkUpdateRates` array mutation + per-item org re-check; server computes rates, calls it once); ~~model assign-checks N×M (`check-items.ts:370`)~~ **DONE** (`modelCheckItems.createManyIfMissing` — one array insert, org stamped from arg, dedup by id); ~~crew submit/approve timesheets~~ **DONE** (`crewTimeEntries.patchManyStatus` — one shared set over N ids, per-item org re-check + TOCTOU status gate); services confirm/cancel-all crew (use `patchManyStatus`); warehouse `checkOutKitsBatch`/`checkInKitsBatch` (fold the per-kit loop into one mutation); T&T batch-create; maintenance asset-links (`createMany`); check-record submit (`writeCheckRecordsToConvex` loop); CSV imports; Woo order line-items. Each becomes one array mutation with partial-success where inventory/money is involved.

### Not multi-select today (no batch needed unless you want the *feature*)
suppliers, locations, categories still have **no multi-select UI**. Note: assets have **no category field** (category is on the model), so "apply category to N assets" isn't applicable.
- **DONE (built 12 Jul):** **bulk-tag N assets** (append semantics — `api.assets.bulkAddTags` array mutation + `bulkTagAssets` server action + "Add tags" bulk-bar action) and **bulk-archive N clients** (`api.clients.bulkArchive` + `bulkArchiveClients` + row-selection added to the clients table). Both are single-call array mutations with per-item org re-check, matching the invariant.

### Cleanups surfaced by the sweep
- **DONE (12 Jul): Notifications "Dismiss All"** now persists server-side via the same DB-backed dismissal system as the bell, in **one bulk call** (`dismissNotifications` → `notificationDismissals.createManyIfMissing`). Was localStorage-only.
- **Dead/unwired batch fns (still open):** `reorderCustomFieldDefinitions` (no UI), test-tag `BatchCreateDialog` (orphaned), `acceptAllSuggestedPrices` (no call site). Wire or delete.

---

---

## Appendix B — Convex efficiency standard + DB I/O audit

**Why:** prod Database I/O hit **5.58 GB / 1 GB (5.6× over)** on tiny data (1 org, 3 users) — pure query inefficiency. Convex bills I/O as **bytes read per function execution**, and a **reactive** (subscribed) query **re-reads its ENTIRE read-set on any write to any table it touched.** So a subscribed query that `.collect()`s an org-wide range is billed that whole scan on every unrelated change. This section is the enforced standard for ALL Convex code (existing + new), backed by a 3-angle audit (queries / client subscriptions / mutations+indexes).

### The standard (review every Convex query/mutation/subscription against these)
1. **Index-scoped reads only.** Read via the narrowest `.withIndex()` range; never `.collect()` a whole table or org-wide range when a subset / count / point-read by id suffices.
2. **No global-index cross-org scans.** `by_cuid` / `by_modelId` are GLOBAL; reading a range then `.filter(r => r.organizationId === orgId)` reads (and bills) cross-org rows. Prefer point-reads by id (org-rechecked) or an org-composite index.
3. **Bundles resolve referenced-only.** A `*.bundle` resolves related rows by *referenced id* (point-reads), never by collecting the whole related table. Reference pattern: `equipmentTab.ts`, `assetDetail.ts`. Anti-pattern (being fixed): old `overbooking.bundle`, `projectEquipment.browserBundle`.
4. **Reactive read-set = recurring cost.** Keep hot subscriptions' read-sets minimal and project-scoped; split org-wide / high-churn slices (availability, counters, presence) into their own narrow queries so an unrelated write doesn't re-run the whole page.
5. **Maintained counters / Aggregate for tallies.** Never `.collect()` to compute a count/sum/max on a hot path — use per-write counters (`convex/lib/counters.ts`) or the Aggregate component. `max(sortOrder)+1` → a descending composite-index `.first()` (1 doc).
6. **One subscription per (query, args).** Canonicalize args (**sort arrays**) so identical subscriptions dedupe; hoist per-row subscriptions to one per-entity batch query.
7. **Gate heavy subscriptions.** `"skip"` big bundles/lists when their tab/section is hidden (the query cache keeps them billing for 5 min after unmount otherwise).
8. **Pickers search, not full-table.** Search-driven pickers use `search.*`; tables that need all rows project only the fields they render.

**Enforcement:** no `.collect()` over an org-wide/global range on a subscribed path without a written justification; new bundles must be referenced-only; this list is a PR-review gate.

### Audit findings — prioritized (✅ done / ▶ safe-now / ⚙ needs index/refactor)

| Pri | Item | Location | Fix | Status |
|---|---|---|---|---|
| 1 | `overbooking.bundle` double-subscribed, un-dedupable (unsorted `modelIds`) | `use-native-equipment-tab.ts`, `overbooking-core.ts` | sort modelIds → cache dedupes to one sub | ✅ done (ships via image) |
| 1 | `overbooking.bundle` re-reads whole projects + whole models tables reactively | `convex/overbooking.ts:29-30` | referenced-only point-reads (consumer looks up by id) | ✅ done (needs Convex deploy from main) |
| 2 | `projectEquipment.browserBundle` collects whole org models/suppliers/categories | `convex/projectEquipment.ts:46-48` | narrow to referenced cuids (mirror equipmentTab) — verify tree consumer first | ▶ staged |
| 2 | Project tree read twice per detail page (`browserBundle` + `equipmentTab.bundle`) | detail composite + equipment tab | equipment tab consume the detail composite's tree | ⚙ refactor |
| 3 | 2×N per-row `getLock`/`getReviewMarker` subscriptions | `equipment-rows.tsx:1140-1147` | one per-entity `listLocksForEntity` + `listReviewMarkersForEntity` (both exist); thread maps to `LineItemRow` | ▶ safe-now |
| 4 | `swapLineItemAsset` reads all org projects per reassign | `projectLineItems.ts:722` | range-scan `by_organizationId_rentalStartDate` (exists) | ✅ done (PR #426) |
| 4 | `checkAvailability` reads all org projects | `availabilityCheck.ts:26` | referenced-only by projectId | ✅ done (PR #426) |
| 5 | `dashboardLists` upcoming/home/blocking read whole projects + PM tables | `dashboardLists.ts:67,100,149` | use range-scan + `by_projectManagerId`/`by_userId` | ✅ done (PR #425) |
| 5 | `dashboardStats` whole projects/maintenance collect (minute-bucketed reactive) | `dashboardStats.ts:33-48` | composite index range-scan | ⚙ needs index (maintenance) |
| 6 | `nextLineSort` (both copies) collect whole set to compute max(sortOrder) (O(N), bulk→O(N²)) | `projectLineItems.ts`, `lineItemWrites.ts` | `by_projectId_sortOrder` `.order("desc").first()` | ✅ done (PR #427). Groups/categories/warehouse copies operate on tiny sets (<~20) → low-value, skipped |
| 6 | `fileUploads.getByThumbnailUrl` full-table cross-org scan | `fileUploads.ts:43` | add `by_thumbnailUrl` index | ✅ done (PR #427) |
| 7 | `models.list` whole-table reactive (4.5K) for pickers | `models.ts:16` + `use-models.ts` | field-project; route search-pickers to `search.models` | ▶ behaviour |
| 7 | Server-side per-item Convex loops (duplicateProject, deleteProject, kit checkout/checkin, check-items→models, per-day shifts) | `src/server/*` (see Tier 4) | collapse into existing `patchMany`/`listByIds`/`bulkUpdate`; author `projectLineItems.createMany`, kit-batch, shifts-batch | ⚙ mix (ties to §Appendix-A bulk) |
| — | Notifications double 60s poll (feed + dismissals) | `use-notifications-feed.ts`, `notifications.tsx:77` | piggyback dismissals on feed tick; longer-term reactive sub | ▶ safe-now |

**Not issues (checked):** `activityLogWrites.record` (O(1) point-read + insert; the 5.6K is mirror-bridge call *count*, not I/O), `dashboardCounters` (already maintained per-write), `recalcProjectTotals` (project-scoped), `search.*` (bounded — the correct model). No `query().filter()` full-table scans exist (every `.filter()` follows a `.withIndex()`).

**Shipping note:** these fixes must reach prod via a **main-based branch → CI** (which deploys Convex + builds the image atomically). Do NOT `convex deploy` from a feature worktree — this one carries unrelated kit-per-unit work not in main.

---

**Provenance:** builds on the in-progress domain decommission (Phase A done, Phase B underway). Two `/autoplan` passes: (1) the wedge review (superseded by the user's full-native directive), (2) the full-native execution review (this doc's §4 gates + §6 corrections). Restore points under `~/.gstack/projects/gearflow/` (`…194629` wedge, `…202449` full-native v2).
