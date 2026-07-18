# Feature Flags

Per POLICY.md **R-4.3**: every flag has an owner and an expiry/removal condition, and is
reviewed at the quarterly sweep (R-12.1).

**Owner (all flags below): Jayden Nawotka**

## `NATIVE_*` — Prisma→Convex write-path migration flags

These gate the Convex-native (browser-direct) write path per domain. While a flag is off, writes
run through the legacy `src/server/*` server actions; when on, they run through the native
`convex/*Writes.ts` mutations. They exist only for the duration of the Prisma→Convex migration
(see [[convex-native-phase-progress]] in project notes).

**Removal condition (all):** once the domain's native write path is confirmed in prod, remove the
flag AND delete the corresponding legacy server-action path (this also closes R-4.5 migration
residue). Target: within 30 days of each domain reaching 100% native in prod (T-6).

| Flag | Domain | Removal condition |
|---|---|---|
| `NATIVE_LINEITEM_WRITES` | Line items | Native line-item writes verified in prod → delete `src/server/line-items.ts` legacy path |
| `NATIVE_PROJECT_WRITES` | Projects | Native project writes verified → delete legacy project write path |
| `NATIVE_CREW_WRITES` | Crew | Native crew writes verified → delete legacy crew write path |
| `NATIVE_KIT_WRITES` | Kits | Native kit writes verified → delete legacy kit write path |
| `NATIVE_ACTIVITY_WRITES` | Activity log | Native activity writes verified → delete legacy `logActivity` DB path |
| `NATIVE_EMAIL_SIDEEFFECTS` | Email side-effects | Native email side-effects verified → delete legacy trigger |
| `NATIVE_RECALC` | Money recalculation | Native recalc verified as sole path → delete `src/server` recalc |

_Reviewed 2026-07-18. Re-check each quarterly sweep; remove flags whose removal condition is met._
