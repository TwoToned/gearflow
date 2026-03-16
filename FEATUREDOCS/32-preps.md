# Preps (Temporary Kits for Project Staging)

## Overview
Preps are **temporary kits** used to pre-group assets for a specific project deployment. They are implemented as `Kit` records with `isPrep: true` — sharing the same line item parent-child structure, checkout/checkin flows, and PDF rendering as regular kits. Unlike permanent kits, prep-kits are project-scoped, created on-the-fly, and dissolved after use.

## Data Model

Preps reuse the existing `Kit` model:

```
Kit (isPrep: true)
├── assetTag: "PREP-{hash}" (auto-generated) or case asset tag
├── name: user-defined
├── status: AVAILABLE | CHECKED_OUT | IN_MAINTENANCE | RETIRED
├── isPrep: true
└── lineItems → ProjectLineItem (parent, isKitChild: false, kitId set)
    └── childLineItems → ProjectLineItem[] (children, isKitChild: true)
```

### Asset Tag
- **With case asset**: Uses the case asset's existing tag (e.g., `CASE-001`)
- **Without case**: Auto-generates `PREP-{timestamp}-{random}` (e.g., `PREP-ABCD1234-X9K2`)
- UI hides `PREP-*` tags and shows `—` instead; real asset tags display normally

### Case Asset
An optional physical container (from the org's "case" category). When provided:
- The prep-kit uses the case asset's tag
- The case asset becomes a child line item inside the prep-kit
- Case child is excluded from removal UI (stays with the prep)

## Server Actions (`src/server/kits.ts`)

### CRUD
- **`createPrepKit(projectId, name, caseAssetId?)`** — Creates `Kit` with `isPrep: true`, parent `ProjectLineItem` with `kitId`. If case asset provided, creates child line item for it.
- **`dissolvePrepKit(kitId)`** — Un-parents all children (merges split bulk qtys back), deletes parent line item, deletes Kit record. Blocked if kit is `CHECKED_OUT`.
- **`getProjectPrepKits(projectId)`** — Lists all prep-kits (`isPrep: true`) with 3-level nested child includes.

### Adding Items
- **`addItemToPrepKitByTag(prepKitId, assetTag, quantity?)`** — Scan-based add. Handles three types:
  - **Kit scan**: Re-parents the kit's parent line item under the prep-kit
  - **Serialized asset**: Finds/splits matching project line item, re-parents under prep-kit
  - **Bulk asset**: Splits requested qty from project line item, re-parents under prep-kit. If no qty remaining on project, returns `{ needsProjectAdd: true }` to trigger add-to-project flow.
  - If asset is inside a physical kit, rejects with "scan the kit instead"

- **`addItemToPrepKit(prepKitId, lineItemId, quantity?)`** — Direct line item re-parenting (used by UI list selection)

- **`addToPrepKitAndProject(prepKitId, opts)`** — Two-step: adds item to both the project AND the prep-kit. Used when scanned item isn't on the project. Handles mixed flow: decrements existing project line items for "on job" portion, creates new line items for excess.

- **`searchPrepKitItems(prepKitId, query)`** — Searches org-wide assets by name/tag/model. Returns availability info: `onProjectQty`, `availableQty`, `totalQty`, and whether item is already `onProject`.

### Removing Items
- **`removeItemFromPrepKit(prepKitId, lineItemId, quantity?)`** — Un-parents child, merges split bulk quantities back to original line items.

### Deploy / Return
Prep-kits use the **same** `checkOutKit()` / `checkInKit()` as regular kits — no separate actions needed. The kit + all children are updated atomically.

## UI

### Preps Tab (`src/components/warehouse/preps-tab.tsx`)
Located on the warehouse page as a third tab (`?tab=preps`).

- **List view**: Cards showing name, asset tag, item count, status badge
- **Create dialog**: Optional case asset search + custom name
- **Detail dialog**:
  - Scan input for barcode scanning
  - Debounced search with availability display: "X on job · Y available · Z total"
  - Quantity picker for bulk items (max = total org inventory)
  - Confirmation prompt when qty exceeds on-project amount
  - Contents list with nested kit expansion, +/− qty controls, remove buttons
  - Action buttons: Deploy, Return, Dissolve (context-dependent on status)

### Deploy/Return Tabs
Prep-kits appear identically to regular kits in the deploy/return tables:
- Expandable parent row with indented children
- `PREP-*` asset tags hidden (show `—`); real case asset tags shown
- Nested kits inside prep-kits render with chevron expand, Container icon, Kit badge
- Nested kit children render at deeper indent
- Checkbox selection routes to `kitCheckOutMutation` / `kitCheckInMutation`

### Kit Verification
Before deploying or returning a kit/prep-kit with unverified items:
- Confirmation dialog shows "X/Y items verified — deploy/return anyway?"
- Verification circles are **clickable** (not scan-only) for all children and grandchildren
- `verifiedKitItems` Set tracks confirmed asset IDs
- Applies to both kits and prep-kits equally

### PDF Documents
Prep-kit items render on all 5 PDFs (packing list, delivery docket, return sheet, quote, invoice):
- Prep-kit parent shows as group header
- Children indented below
- Nested kits inside prep-kits show as `[Kit] Name` with their own indented children
- `PREP-*` tags display as `"-"` on documents

### Project Equipment List
Prep-kit groups render in `line-items-panel.tsx` with:
- Parent row showing kit name and tag
- Nested kits detected by `kitId` on children, rendered with Container icon and Kit badge
- Nested kit children at deeper indent with muted styling

## Prep vs Kit

| | Regular Kit | Prep-Kit |
|---|---|---|
| `isPrep` | `false` | `true` |
| Purpose | Permanent physical container | Temporary project-specific grouping |
| Lifecycle | Org-scoped, reused across projects | Project-scoped, dissolved after use |
| Asset tag | Custom or auto-incremented | `PREP-{hash}` or case asset tag |
| Container | Kit IS the container | Optional case asset becomes child |
| Contents | Fixed (`KitSerializedItem`, `KitBulkItem`) | Dynamic (re-parented `ProjectLineItem`s) |
| Adding items | Kit management page | Warehouse preps tab (scan/search) |
| Removal | Unpack kit | `dissolvePrepKit()` — un-parents all, deletes Kit |
| Deploy/Return | `checkOutKit` / `checkInKit` | Same functions (shared) |
| Line item parent | `kitId` on parent, `isKitChild` on children | Same fields (shared) |
| On documents | Kit group header with children | Same rendering (shared) |
| Verification | Clickable circles + scan | Same flow (shared) |

## Permissions
- Uses existing `warehouse.check_out` / `warehouse.check_in` for deploy/return
- Kit CRUD permissions apply to prep-kit creation/dissolution
- All roles with warehouse access can manage prep-kits
