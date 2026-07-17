# CSV Import/Export

## Export
- `exportModelsCSV()` — all active models with specs. Now includes `sku` and the
  rental-rate columns (`dailyRate`, `weeklyRate`, `monthlyRate`) so the export
  doubles as a ready-to-edit rate sheet.
- `exportAssetsCSV()` — all active serialized assets
- `exportBulkAssetsCSV()` — all active bulk assets

## Import
- `importModelsCSV(csvContent)` — upsert by name + manufacturer + modelNumber.
  Round-trips `sku` and `dailyRate`/`weeklyRate`/`monthlyRate`; `defaultRentalPrice`
  (the quoting fallback) is synced from `dailyRate` when no explicit value is given.
- `importModelRatesCSV(csvContent)` — **rates-only** bulk update. Matches existing
  models by identifier in priority order **id → sku → modelNumber → name** and
  updates only the rate columns present. **Never creates models** — unmatched,
  ambiguous (a name shared by 2+ models), or invalid rows are reported as row
  errors, not silently skipped. Blank rate cells are left unchanged, so you can
  push just `weeklyRate` without clearing the others. When `dailyRate` is set,
  `defaultRentalPrice` is kept in sync. Requires the `model:update` permission and
  writes a single `logActivity` summary. Pure matching/parsing helpers live in
  `src/lib/rate-import.ts` (unit-tested); the DB-backed action is in
  `src/server/csv.ts` (integration-tested in `csv-rate-import.int.test.ts`).
  Solves the cold-start problem: operators with hundreds of models can populate
  rates from a spreadsheet instead of clicking through forms.
- `importAssetsCSV(csvContent)` — upsert by assetTag, auto-generate tags if missing
- Custom CSV parser (no external deps) with flexible column matching (camelCase, snake_case, Title Case)
- Tags exported as semicolons; import parses them back with lowercase normalization

## UI
`CSVImportDialog` (`src/components/assets/csv-import-dialog.tsx`) — reusable file
upload with progress bar and error display. Supports three modes via the `type`
prop: `"models"`, `"assets"`, and `"rates"` (the rates-only import). The models
table (`src/components/assets/model-table.tsx`) exposes an **Import Rates** button
(gated on `model:update`) alongside Export/Import. Recommended flow: **Export →
fill the rate columns in a spreadsheet → Import Rates**.

## Performance (Phase-3 DoD benchmark, 2026-07-17)

`importAssetsCSV` was benchmarked against prod via `scripts/benchmark-csv-import.ts`
(the closing item on the original Phase-3 DoD, which called for a throughput check
"vs the 16k-write/1s-CPU Convex budget"). Results:

| Rows | Concurrency | Wall clock | ms/row |
|---|---|---|---|
| 200 | 1 | 111.8s | 559.0 |
| 500 | 1 | 265.0s | 530.0 |
| 1000 | 1 | 527.7s | 527.7 |
| 500 | 4 (2000 total) | 1048.6s | 524.3 |

**Finding: the 16k-write/1s-CPU budget doesn't apply here, and that's the problem.**
That budget concerns a single Convex mutation's internal write count — but
`importAssetsCSV` does the opposite of batching: it calls `getConvexClient()` and
issues one `api.assets.create`/`patchAsset` mutation **per CSV row**, sequentially
awaited inside a `for` loop in the Next.js server action. So it never risks the
per-mutation budget (each mutation writes exactly one row), but it also never gets
the wall-clock benefit of batching — throughput is pure server→Convex round-trip
latency × row count, a flat **~525-530ms/row regardless of single-call row count
(200-1000) or concurrent callers (1 vs 4, even at 2000 total rows — no contention,
but no speedup either)**. A 1000-row import takes **~8.8 minutes** in one blocking
server-action call — well past any reasonable request timeout or acceptable UI
wait, for a CSV size a real customer could plausibly upload.

**Not fixed in this pass** (out of scope for a benchmark-only DoD item; flagged as
a follow-up). The fix, if/when CSV import volume becomes a real usage pattern, is
the same pattern already applied to line-items/projects this session: collapse the
per-row loop into ONE backend-local Convex mutation that loops `rows` inside a
single transaction (see `convex/lineItemWrites.ts` `removeManyNative`/
`patchManyNative` for the established shape), which trades N round-trips for one —
at which point the 16k-write/1s-CPU per-mutation budget *does* become the relevant
constraint, and would need its own row-count cap (mirroring `assertBulkSizeOk` in
`convex/lib/rateLimiter.ts`).
