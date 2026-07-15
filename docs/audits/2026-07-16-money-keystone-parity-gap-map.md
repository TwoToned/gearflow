# Money-Keystone Native-vs-Legacy Gap Map (2026-07-16)

Step-1 scoping/parity audit for the Phase-3 money-keystone migration (browser-direct
Convex + delete `src/server/` data layer). Built from 3 parallel adversarial audits +
live prod verification. **Nothing was flipped/changed to produce this — audit only.**

## Ground truth (verified live, corrects stale memory)
- **Prod money flags are ALREADY ON** (verified `docker exec <app> env` on the prod box,
  container `ghcr.io/twotoned/gearflow:latest`): `NATIVE_LINEITEM_WRITES`,
  `NATIVE_PROJECT_WRITES`, `NATIVE_RECALC`, `NATIVE_ASSET/KIT/CREW_WRITES`,
  `NATIVE_ACTIVITY_READS/WRITES` all `=true`. The "one-flip recalc win" is **live** — the
  native money math (`convex/lib/recalc.ts` + `lineItemWrites.*Native` + `projectWrites.*`)
  is battle-tested by real prod writes → **math parity de-risked.**
- **`recalcProjectTotals` (`convex/lib/recalc.ts`) is byte-parity** with legacy
  `recalculateProjectTotals` (`src/server/line-items.ts:1610`), parity-tested
  (`convex/recalc.test.ts`). Prod = 307 healthy.
- **`search.ts` raw-SQL Stage-4 blocker is GONE** — `src/server/search.ts` deleted; native
  `convex/globalSearch.ts` + `convex/search.ts`. Only remaining `$queryRaw` is test fixtures.
- **How the flags route today:** the flag makes the SERVER ACTION call the native mutation
  with a **SERVICE token** (`getConvexClient()` → `src/lib/convex-client.ts:36`). Under a
  service token the 4 browser guards short-circuit; the server action still runs
  zod + `requirePermission` + availability + pricing + cascade first. **So the flag-on state
  is safe — the gaps below are what blocks BROWSER-DIRECT conversion (user token), not the
  current service-mediated path.**

## ⚠️ Latent exposure (the one thing worth noting now)
Every `*Native` mutation in `lineItemWrites.ts`/`projectWrites.ts` is a **public** `mutation`
(user-token-reachable by design — `convex/lib/auth.ts:196`). They were built EARLY and
**presuppose the server action enforced availability/pricing/validation**, so they do NOT
meet the in-mutation enforcement bar the later-shipped `*Writes.ts` (crew/asset/kit/PM) all
hold. A member with `manage_line_items` could craft a direct Convex call to
`addNative`/`patchNative`/`updateNative` and bypass availability + money integrity. Prod is
DARK (1 org, 3 trusted users) so practical risk ≈ 0, but this is the strongest reason to
harden these two files BEFORE onboarding real users or going browser-direct.

Live browser-direct today: only `projectWrites.updateNotesNative` (SAFE — field-union
constrained). `use-native-line-item-writes.ts` is an optimistic READ overlay only; the real
line-item write still lands via the server action.

---

## Files WITH native browser-callable mutations (need HARDENING)

### `convex/lineItemWrites.ts` (7 mutations)
| Mutation | Bar met? | Gaps |
|---|---|---|
| removeNative | ✅ full parity | — |
| reorderNative | ✅ (3 guards correct — no audit) | — |
| recalcNative | ✅ byte-parity | — |
| addCustomNative | ⚠️ | MF-3 (no finite guard), MF-4 (trusts client `lineTotal`) |
| patchNative | ❌ | MF-2 (`set: v.any()`, strips only org/id/projectId → can set `status`/`isKitChild`/`parentLineItemId`/`lineTotal`/fulfillment counters), MF-3, MF-4, missing stale-guard + qty↑ availability re-check |
| addNative | ❌ | MF-1 (NO availability/double-booking/asset-in-kit/RETIRED-LOST), MF-3, MF-4, NTH merge-dedup + auto-pricing absent |
| addKitNative | ❌ | MF-1 (NO kit availability + IN_MAINTENANCE/INCOMPLETE guard) |

### `convex/projectWrites.ts` (6 mutations)
| Mutation | Bar met? | Gaps |
|---|---|---|
| updateNotesNative | ✅ (live browser-direct, safe) | — |
| updateStatusNative | ⚠️ | missing blocking-comments gate parity |
| archiveNative | ✅ | — |
| updateNative | ❌ | **money-anchor injection** (`sanitizeClientSet` doesn't strip `total`/`margin`/`equipmentRevenue`/… nor `projectNumber`/`isTemplate`), missing projectNumber dup-guard, blocking-comments gate |
| createNative | ❌ | **money-anchor injection** (`projectWriteFields` exposes totals as typed args, inserted raw), project-number allocation is `requireService`-gated → can't go browser-direct |
| deleteNative | ❌ | **NO cascade** (assets/kits stuck CHECKED_OUT, orphaned lines/groups/PMs/crew), no CANCELLED precondition, no isTemplate guard |

### Shared MUST-FIX severity (lineItemWrites)
- **MF-1** (highest) — port availability/double-booking + kit-status enforcement INTO
  `addNative`/`patchNative`/`addKitNative`. Template: `projectLineItems.swapLineItemAsset`
  (range-scan + OCC double-booking gate inside a mutation). = the "line-items keystone".
- **MF-2** — replace `patchNative` `v.any()` with a typed non-structural whitelist (exclude
  `status`/`isKitChild`/`parentLineItemId`/`childKind`/`kitId`/`subHireId`/`isCustomItem`/
  fulfillment counters).
- **MF-3** — `Number.isFinite` + range guard on `quantity`/`unitPrice`/`discount`/`lineTotal`
  in every create/patch (Convex `v.number()` accepts NaN/Infinity/negatives → poisons
  `recalc` totals to NaN).
- **MF-4** — recompute `lineTotal` inside the mutation from validated inputs; ignore client.

### projectWrites MUST-FIX
- Strip money anchors in `updateNative` sanitize + omit from `createNative` insert.
- `deleteNative` cascade + CANCELLED/isTemplate guards (or keep service-only).
- Fold project-number allocation (`reserveNextNumber`, `projectNumberSequences.ts:120`,
  currently `requireService`) into `createNative` before it can be browser-direct.
- Blocking-comments gate parity on update/status.

### projectWrites GAPS (no native twin — block deleting `src/server/projects.ts`)
`duplicateProject`, `saveAsTemplate`, `deleteTemplate`, `deleteProject` cascade body.

---

## Files with ONLY service-gated CRUD mirrors (need `*Writes.ts` AUTHORED)
Every mutation in these is `requireService` — zero browser-callable, and none carry the
orchestration (recalc/cascade/pricing/rate-memory). Each needs a `*Writes.ts` authored to
the `projectManagersWrites.ts` bar, then browser-direct conversion + server delete.
Recalc-coupled domains just `import { recalcProjectTotals } from "./lib/recalc"` and call it.

| Domain | legacy writes | recalc-coupled | carve-outs (stay server) |
|---|---|---|---|
| project-categories | 4 | no | — |
| warehouse-close | 2 | no | — |
| group-templates | 5 | yes (applyGroupTemplate) | — |
| project-groups | 9 | yes | — |
| category-slots | 4 | yes | — |
| project-services | 13 | yes | crew messaging + CSV/template mapping |
| warehouse | 24 | no | crypto webhook emit + blocking-comment gate + native scan query |
| sub-hires | 19 | yes (+ native `recalculateSubHireTotals`/`generateSubHireLineItems`/supplier-rate) | media `refCountFile` union |

---

## Recommended execution order (revised from the brief, given flags already live)
1. **Harden `lineItemWrites` + `projectWrites` to the browser-direct bar** (closes the latent
   public-mutation exposure; non-behavior-changing for the service path):
   1a. Safe defensive slice: MF-3 finite guards + MF-4 lineTotal recompute + MF-2 typed patch
       whitelist + projectWrites money-anchor stripping. *(no availability port yet)*
   1b. Line-items keystone: MF-1 in-mutation availability/double-booking/kit-status + pricing.
   1c. projectWrites deleteNative cascade + numbering fold + blocking-comments.
2. **Browser-direct convert + delete server layer, domain-by-domain** (each its own PR):
   line-items → projects → project-services → project-groups → project-categories →
   group-templates → category-slots → sub-hires → warehouse/close. Author the missing
   `*Writes.ts` per domain (table above) as part of each domain's PR.
3. After server callers deleted: demote dead `requireService` CRUD mirrors to `internal*`.
