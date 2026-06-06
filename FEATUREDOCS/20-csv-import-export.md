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
