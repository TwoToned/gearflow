# 44. Reorder Dashboard

## Overview

`/warehouse/reorder` lists every bulk item at or below its reorder threshold, grouped by preferred supplier. Tick items and generate a draft `SupplierOrder` per supplier in one click.

## Architecture

```
/warehouse/reorder page
  → getReorderCandidates (src/server/reorder.ts, "use server")
  → getReorderCandidatesCore (src/lib/reorder.ts, pure)
  → tick items → createReorderDraft → one draft SupplierOrder per supplier
```

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/reorder.ts` | Pure candidate query + suggested-quantity heuristic |
| `src/server/reorder.ts` | `"use server"` wrappers — candidates + draft creation |
| `src/app/(app)/warehouse/reorder/page.tsx` | Dashboard UI, supplier grouping, draft generation |

## Schema (BulkAsset additions)

- `preferredSupplierId` / `preferredSupplier` — `Supplier?`, `SetNull` on delete. Drives the supplier grouping and pre-fills the draft order.
- `lastReorderedAt` — `DateTime?`, set lazily by `createReorderDraft`. The dashboard shows "ordered N days ago" alongside current stock.

Set the preferred supplier on the bulk asset form (see [08-assets.md](./08-assets.md)).

## Candidate Logic

A reorder candidate is any `BulkAsset` whose available quantity is at or below `reorderThreshold`.

`suggestedOrderQuantity` heuristic: order enough to get back to `threshold × 1.5`, i.e. `threshold × 1.5 − available`, never less than 1. The operator can edit the quantity on the draft.

## Draft Generation

Selected candidates are grouped by `preferredSupplier`. `createReorderDraft` produces one draft `SupplierOrder` per supplier, with order items pre-filled from the suggested quantities and recorded per-unit purchase price, then stamps `lastReorderedAt` on each bulk asset.

## Integration Points

- **Stocktake** (see [43-stocktake.md](./43-stocktake.md)) — counts that reveal shortfalls feed the reorder queue.
- **Suppliers** (see [22-suppliers.md](./22-suppliers.md)) — drafts flow into the existing `SupplierOrder` workflow.
