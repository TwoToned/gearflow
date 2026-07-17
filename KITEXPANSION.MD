# Extension Prompt — Kit System (Asset Containers)

## Context

This is an extension to the existing RVLT Flow asset/rental management platform for AV production companies. The core system (assets, models, projects, warehouse scanning, availability engine) is already implemented. This prompt adds **Kits** — physical containers (road cases, flight cases, pelican cases, racks, work boxes) that hold a fixed set of assets and travel as a single unit.

---

## What is a Kit?

A Kit is a **physical container that is itself an asset**, with its own asset tag, barcode, and QR code. It contains a defined set of other assets (both serialized and bulk) that are permanently assigned to it. When a Kit is added to a project, everything inside it comes along automatically.

**Real-world examples in AV/Theatre:**

- A flight case labelled `KIT-DRUM01` containing 4x SM57s, 2x SM81s, 1x Beta 52A, all the necessary XLR cables, mic clips, and drum clamps — the full drum mic kit
- A road case labelled `KIT-RF01` containing 4x Sennheiser EW-D handheld wireless mics, the EM-D receiver, antenna distro, BNC cables, and spare batteries
- A rack case labelled `KIT-RACK-FOH01` containing a mixer, a system processor, a power conditioner — all bolted into a 12RU rack that never gets disassembled
- A work box labelled `KIT-TOOLS01` containing a multimeter, soldering iron, gaffer tape, cable ties, and a torch — the technician's toolkit

**Key principle:** The contents of a Kit are **fixed and specific**. `KIT-RF01` always contains `GF-SENN-HH-001`, `GF-SENN-HH-002`, `GF-SENN-HH-003`, and `GF-SENN-HH-004` — not just "any 4 Sennheiser handhelds." The system cannot substitute different serialized assets into a Kit. This is because in the real world, those specific units are physically packed inside that specific case. You open the case and those exact items are in there.

Bulk items inside a Kit work slightly differently — the Kit declares a quantity (e.g., "6x 3m XLR cables") and those are deducted from bulk stock when the Kit is created, but individual cables aren't tracked by serial number.

---

## Data Model Changes

### New Model: Kit

```
Kit
- id                    String (cuid)
- organizationId        String → Organization
- assetTag              String (unique within org, e.g., "KIT-RF01")
- name                  String (e.g., "RF Wireless Kit 01")
- description           String? (what this kit is for, how it's used)
- categoryId            String → Category
- status                Enum: AVAILABLE, CHECKED_OUT, IN_MAINTENANCE, RETIRED, INCOMPLETE
- condition             Enum: NEW, GOOD, FAIR, POOR, DAMAGED
- locationId            String → Location (current warehouse/storage location)
- weight                Float? (total packed weight in kg — useful for truck loading)
- caseType              String? (e.g., "12RU Rack", "SKB iSeries", "Road Case", "Pelican 1650")
- caseDimensions        String? (e.g., "600x400x300mm" — for truck packing)
- image                 String? (photo of the kit/case)
- images                String[] (additional photos — open case, label, etc.)
- barcode               String? (generated or manual)
- qrCode                String? (generated)
- notes                 String?
- purchaseDate          DateTime?
- purchasePrice         Float? (cost of the case itself)
- customFieldValues     Json?
- isActive              Boolean (soft delete)
- createdAt             DateTime
- updatedAt             DateTime

// Relations
- kitSerializedItems    KitSerializedItem[]
- kitBulkItems          KitBulkItem[]
- projectLineItems      ProjectLineItem[]     (projects this kit is assigned to)
- scanLogs              AssetScanLog[]
- maintenanceRecords    MaintenanceRecord[]
```

### New Model: KitSerializedItem (join table)

Links specific serialized assets to a Kit. These are **permanent assignments** — the asset lives in this Kit until explicitly removed.

```
KitSerializedItem
- id                    String (cuid)
- organizationId        String → Organization
- kitId                 String → Kit
- assetId               String → Asset (serialized)
- position              String? (e.g., "Slot 1", "Top Tray", "Rack Unit 3-4")
- sortOrder             Int (display ordering within the kit)
- addedAt               DateTime
- addedBy               String → User
- notes                 String? (e.g., "Velcroed to lid", "Bottom foam insert")

// Constraints
// - assetId must be unique across ALL KitSerializedItems in the org
//   (a serialized asset can only belong to one Kit at a time)
// - The asset's status should be automatically managed based on the Kit's status
```

### New Model: KitBulkItem (join table)

Links a quantity of bulk stock to a Kit.

```
KitBulkItem
- id                    String (cuid)
- organizationId        String → Organization
- kitId                 String → Kit
- bulkAssetId           String → BulkAsset (or however bulk assets are currently modelled)
- quantity              Int (how many of this bulk item are in this kit)
- position              String? (e.g., "Cable pouch", "Side pocket")
- sortOrder             Int
- addedAt               DateTime
- addedBy               String → User
- notes                 String?

// When a bulk item is added to a Kit, the quantity is deducted from
// the bulk asset's available stock. When removed, it's returned.
```

### Modifications to Existing Models

#### Asset (Serialized)
Add:
```
- kitId                 String? → Kit (nullable — null means asset is standalone)
- kitItemId             String? → KitSerializedItem (back-reference)
```

When an asset has a `kitId`, it is "inside" that Kit. The asset's individual `status` and `locationId` should mirror the Kit's — the Kit is the source of truth for where its contents are.

#### BulkAsset
The `availableQuantity` calculation must now also subtract quantities allocated to Kits:
```
availableQuantity = totalQuantity - quantityCheckedOutToProjects - quantityAllocatedToKits - quantityInMaintenance
```

#### ProjectLineItem
Add support for Kit line items:
```
- kitId                 String? → Kit (when the line item represents a Kit)
- isKitChild            Boolean (default false — true for auto-generated child line items)
- parentLineItemId      String? → ProjectLineItem (self-reference — child items point to the Kit line item)
```

When a Kit is added as a line item, the system auto-generates child line items for every asset and bulk item inside the Kit (see behaviour below).

#### AssetScanLog
Add:
```
- kitId                 String? → Kit
```

Scanning should support both scanning the Kit itself and scanning individual items within a Kit.

#### MaintenanceRecord
Add:
```
- kitId                 String? → Kit
```

Kits can have their own maintenance records (e.g., "replaced foam insert", "repaired latch", "case wheel broken").

---

## Behaviour & Business Logic

### Adding a Kit to a Project

When a user adds a Kit to a project:

1. **Create the Kit line item** on the project with `type: EQUIPMENT`, linked to the Kit
2. **Auto-generate child line items** for every item inside the Kit:
   - One child line item per `KitSerializedItem` — linked to the specific asset, marked `isKitChild: true`, `parentLineItemId` pointing to the Kit line item
   - One child line item per `KitBulkItem` — linked to the bulk asset with the specified quantity, marked `isKitChild: true`
3. **Child line items inherit dates** from the project (rental start/end)
4. **Child line items are not independently editable** in the normal project UI — they come and go with the Kit. But they should still be visible (expandable/collapsible under the Kit line item) so users can see exactly what's in the Kit
5. **Pricing**: The Kit line item can have its own price (e.g., "Drum Mic Kit — $150/day") OR pricing can roll up from the individual items inside. Make this configurable per line item — a `pricingMode` field: `KIT_PRICE` (single price on the Kit) or `ITEMIZED` (sum of child item prices). Default to `KIT_PRICE`.
6. **Removing a Kit from a project** removes all its child line items too

### Availability & Conflict Detection

The availability engine must be updated:

- **When checking Kit availability:** A Kit is available if the Kit itself is not booked on overlapping dates AND all of its serialized contents are not independently booked (they shouldn't be, because they're in a Kit — but guard against edge cases)
- **When a serialized asset is inside a Kit:** That asset CANNOT be independently added to a project. The system must prevent this and show a message like "This asset is part of Kit KIT-RF01. Add the Kit instead."
- **When checking a standalone serialized asset's availability:** If it's inside a Kit, it's only available when the Kit is available
- **Bulk items in Kits:** The quantities allocated to Kits are permanently deducted from available stock (they're physically inside the case). They don't fluctuate with project dates — they're always allocated to the Kit regardless of whether the Kit is on a project or sitting in the warehouse

### Kit Status Management

The Kit has its own status that drives the status of its contents:

| Kit Status | Meaning | Content Assets Status |
|---|---|---|
| `AVAILABLE` | Kit is in warehouse, ready to go | All contents → `AVAILABLE` (but still inside Kit) |
| `CHECKED_OUT` | Kit is out on a project | All contents → `CHECKED_OUT` |
| `IN_MAINTENANCE` | Kit or something inside it needs work | All contents → `IN_MAINTENANCE` |
| `INCOMPLETE` | An item is missing or damaged | Kit is not available for checkout |
| `RETIRED` | Kit decommissioned | Contents should be removed and returned to standalone stock |

**Important:** Individual assets inside a Kit should NOT have their status changed independently while they're in the Kit. The Kit is the unit of management. If a single mic inside a Kit is broken, the Kit status changes to `IN_MAINTENANCE` or `INCOMPLETE`, and a maintenance record is created on the specific asset.

### Kit Integrity / Completeness Checking

A Kit has an expected manifest (its `KitSerializedItems` and `KitBulkItems`). The system should support verifying that a Kit is complete:

- **Kit Audit/Verify mode**: A user opens a Kit's detail page and uses the scanner (or manual checkboxes) to verify each item is present. Unscanned items are flagged as potentially missing.
- **On check-in (return from project)**: After scanning the Kit itself, prompt the user to verify contents. This can be a quick "all items present?" confirmation or a full item-by-item scan.
- **Incomplete Kit**: If items are missing, the Kit status changes to `INCOMPLETE` and cannot be checked out to another project until resolved. Log which items are missing.

### Check-Out Workflow (Updated)

The existing check-out workflow needs to handle Kits:

1. **Scanning a Kit barcode during project check-out:**
   - The Kit and all its contents are marked as checked out in one action
   - The scan log records the Kit scan AND auto-logs each contained asset
   - The project line item (Kit) and all child line items update to `CHECKED_OUT`
   - No need to individually scan each item inside the Kit during check-out (the whole point of a Kit is that it travels as a unit)

2. **Scanning an individual asset that's inside a Kit:**
   - The system should recognize the asset is part of a Kit
   - Show a message: "This asset is part of Kit [KIT-RF01]. Would you like to check out the entire Kit?"
   - If yes → check out the Kit (same as scanning the Kit barcode)
   - Do NOT allow checking out just the individual asset while it's assigned to a Kit

3. **Standalone assets (not in a Kit):**
   - Work exactly as they do now — no change

### Check-In Workflow (Updated)

1. **Scanning a Kit barcode during project return:**
   - The Kit and all its contents are marked as returned
   - Optionally prompt for Kit integrity check (verify contents)
   - Update all child line items to `RETURNED`
   - Log return condition on the Kit

2. **If a Kit comes back incomplete:**
   - Allow partial check-in — the Kit is returned but flagged `INCOMPLETE`
   - Individual missing items remain as `CHECKED_OUT` or are flagged `MISSING`/`LOST`
   - Create a follow-up task or maintenance record for the missing items

3. **Scanning an individual asset that's inside a Kit during return:**
   - Recognize it's part of a Kit
   - Offer to check in the full Kit, or mark just this individual item as verified/returned (for item-by-item verification)

### Kit Management UI

#### Kit List Page
- Table/grid view of all Kits
- Columns: Asset Tag, Name, Category, Status, Condition, Location, Item Count, Current Project (if checked out)
- Filters: status, category, location
- Search by asset tag or name

#### Kit Detail Page
- **Header**: Kit asset tag, name, status badge, condition, photo, case type/dimensions, weight
- **Contents Tab**: 
  - List of all serialized items with: asset tag, model name, position in kit, status, condition
  - List of all bulk items with: name, quantity, position in kit
  - "Add Item" button to assign a serialized asset or bulk quantity to the kit
  - "Remove Item" button to take an asset out of the kit (returns it to standalone stock)
  - "Verify Kit" button to start integrity check / audit mode
- **History Tab**: Project history (which projects this kit has been on), scan log
- **Maintenance Tab**: Maintenance records for the kit (case repairs, foam replacement, etc.)
- **Photos Tab**: Photos of the kit, open/closed, label, contents layout
- **Notes Tab**: Free-form notes

#### Kit Creation Flow
1. Create the Kit (name, asset tag, category, case type, location)
2. Add serialized assets — search/scan to find assets and assign them to the Kit
   - System validates the asset isn't already in another Kit
   - System validates the asset isn't currently checked out on a project
   - Asset's `kitId` is set, asset's location follows the Kit's location
3. Add bulk items — select a bulk asset type and specify quantity
   - System validates sufficient available quantity exists
   - Quantity is deducted from bulk stock
4. Kit status → `AVAILABLE`

#### Adding a Kit to a Project (UI)
- In the project line items area, add a new option: "Add Kit"
- Search/browse Kits by name or asset tag
- When selected, show the Kit contents in an expandable preview before confirming
- After adding: the Kit appears as a line item with a collapsible section showing all child items
- Kit line items should be visually distinct (e.g., an icon, indentation of child items, a subtle background colour for the group)

---

## Project Line Items Display (Updated)

The project equipment list should now support this visual hierarchy:

```
┌─────────────────────────────────────────────────────────────┐
│ KIT-RF01 — RF Wireless Kit 01              $200/day  Kit │
│   ├── GF-SENN-HH-001 — Sennheiser EW-D HH         (incl) │
│   ├── GF-SENN-HH-002 — Sennheiser EW-D HH         (incl) │
│   ├── GF-SENN-HH-003 — Sennheiser EW-D HH         (incl) │
│   ├── GF-SENN-HH-004 — Sennheiser EW-D HH         (incl) │
│   ├── GF-SENN-RX-001 — Sennheiser EM-D Receiver    (incl) │
│   ├── 4x BNC Cable 1m                               (incl) │
│   └── 8x AA Battery                                 (incl) │
├─────────────────────────────────────────────────────────────┤
│ GF-DLIVE-001 — Allen & Heath dLive S7000    $500/day      │
├─────────────────────────────────────────────────────────────┤
│ 4x SM58 — Shure SM58                         $20/day each  │
├─────────────────────────────────────────────────────────────┤
│ KIT-DRUM01 — Drum Mic Kit                  $150/day  Kit │
│   ├── GF-SM57-001 — Shure SM57                     (incl) │
│   ├── GF-SM57-002 — Shure SM57                     (incl) │
│   ├── ...                                                   │
│   └── 6x 5m XLR Cable                               (incl) │
└─────────────────────────────────────────────────────────────┘
```

- Kit child items are collapsible (expanded by default on detail view, collapsed on quotes)
- Child items show "(incl)" instead of a price when Kit pricing mode is `KIT_PRICE`
- Child items show individual prices when Kit pricing mode is `ITEMIZED`
- On PDF documents (quotes, packing lists), Kits can be shown as a single line or expanded — make this a document generation option

---

## Document Generation Updates

### Quote/Proposal PDF
- Kits can appear as a single line ("RF Wireless Kit 01 — $200/day") or expanded with contents listed below — add a toggle/option for this when generating
- When expanded, child items are indented and show "(included)" instead of individual prices (unless itemized pricing mode)

### Pull Sheet
- Kits should appear as a single pull item: "Pull Kit KIT-RF01 from Shelf B3"
- Optionally list contents below for verification during prep
- Standalone assets and bulk items appear separately as usual

### Packing List
- Kits are a single line with total weight
- Contents can be listed if the "expanded" option is selected
- Useful for customs/freight documentation

### Return Sheet
- Each Kit has a verification checklist: Kit scanned ☐, then each contained item listed with a checkbox and condition column

---

## Edge Cases to Handle

1. **Moving an asset out of a Kit while the Kit is checked out on a project**: Block this. The Kit must be returned first.

2. **Adding an asset to a Kit that is currently on a project**: Block this. The Kit must be available.

3. **A Kit is on a project and one item inside breaks on site**: Allow creating a maintenance record on the individual asset while the Kit is checked out. On return, the Kit can be flagged as `INCOMPLETE` or `IN_MAINTENANCE` depending on severity.

4. **Deleting/retiring a Kit**: Remove all assets from the Kit first (return them to standalone stock), then retire the Kit entity. Don't cascade delete the assets.

5. **An asset is inside a Kit but someone tries to add that same asset individually to a project**: Block with clear error message — "Asset GF-SENN-HH-001 is part of Kit KIT-RF01. Remove it from the Kit first, or add the Kit to the project instead."

6. **Nested Kits**: Do NOT support Kits inside Kits for v1. A Kit can only contain serialized assets and bulk items, not other Kits. This keeps the logic manageable. If needed later, this can be revisited.

7. **Kit on a project in QUOTING status**: The Kit and its contents are soft-reserved (tentative hold). If the project is confirmed, the hold becomes firm. If cancelled, the Kit is released. Same logic as standalone assets — just applied to the Kit as a unit.

8. **Partial Kit checkout**: Not supported. A Kit is all-or-nothing. If you only need 2 of the 4 wireless mics, don't use the Kit — pull the individual assets. Or create a different Kit.

---

## Migration Considerations

If there are existing serialized assets that should be grouped into Kits:

1. Create the Kit entities
2. Assign existing assets to Kits via `KitSerializedItem`
3. Update the assets' `kitId` field
4. Deduct bulk quantities from available stock for `KitBulkItem` entries
5. Ensure no assigned assets are currently on active projects (or handle gracefully)

---

## Summary

The Kit system treats a physical container as a first-class entity that manages a fixed set of contents. It simplifies project planning (add one Kit instead of 8 individual items), speeds up warehouse operations (scan one barcode to check out an entire case), and reflects how AV gear actually lives in the real world — packed in cases with specific items that belong together.

The key architectural decisions are:
- **Kits are assets themselves** with their own tags and lifecycle
- **Contents are fixed and specific** — no substitution of serialized items
- **Check-out/check-in operates on the Kit as a unit**
- **Project line items expand** to show Kit contents as non-editable children
- **Availability engine treats the Kit as atomic** — the Kit and all its contents are available or they're not
- **No nested Kits** in v1