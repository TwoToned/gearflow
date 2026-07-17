# 46. Custom Fields

## Overview

Operator-defined asset attributes. Define fields like rig number, firmware version, or road-case colour at `/settings/custom-fields`; they render on the asset create/edit form and detail page. Supports text, number, date, dropdown, and yes/no field types.

## Architecture

```
/settings/custom-fields → manage CustomFieldDefinition rows
  → definitions render inputs on the asset form (CustomFieldsInput)
  → values stored in Asset.customFieldValues JSON, keyed by fieldKey
  → asset detail page reads them back (CustomFieldsDisplay)
```

### Key Files

| File | Purpose |
|------|---------|
| `convex/customFieldDefinitions.ts` (reads) + `convex/customFieldDefinitionsWrites.ts` (browser-direct `createNative`/`updateNative`/`removeNative` mutations, via `src/hooks/use-custom-fields-writes.ts`) | CRUD for definitions |
| `src/lib/validations/custom-field.ts` | Zod schemas, value validation per field type |
| `src/app/(app)/settings/custom-fields/page.tsx` | Definition management UI |
| `src/components/custom-fields/custom-fields-input.tsx` | Renders definition-driven inputs on a form |
| `src/components/custom-fields/custom-fields-display.tsx` | Renders values on a detail page |

## Schema

### CustomFieldDefinition

- `entityType` — `CustomFieldEntity` enum (`ASSET`, `BULK_ASSET`, `KIT`, `PROJECT`). v1 wires `ASSET` only; the enum exists for forward-compat once the other entities all carry a values column.
- `label` — human label shown on the form ("Rig Number")
- `fieldKey` — stable machine key into the `customFieldValues` JSON. Immutable once set.
- `fieldType` — `TEXT`, `NUMBER`, `DATE`, `SELECT`, `BOOLEAN`
- `options` — choices for `SELECT` type, empty otherwise
- `required`, `helpText`, `sortOrder`, `isActive`
- Unique on `(organizationId, entityType, fieldKey)`

### Value storage

Values live in the entity's existing `customFieldValues` JSON column (already present on `Asset` and one other model), keyed by `fieldKey`. No per-value rows — the definition drives the form, the JSON holds the data.

## Behaviour

- The asset form (`asset-form.tsx`) and bulk-asset form render active definitions via `CustomFieldsInput`, sorted by `sortOrder`.
- The asset detail page renders saved values via `CustomFieldsDisplay`.
- `required` definitions are enforced by the Zod layer in `custom-field.ts`.
- Changing a definition's `label`, `options`, or `sortOrder` is safe; `fieldKey` is immutable so existing JSON values keep resolving.

## Integration Points

- **Assets** (see [08-assets.md](./08-assets.md)) — custom fields render on the asset create/edit form and detail page.
- **Settings & Admin** (see [27-settings-admin.md](./27-settings-admin.md)) — definitions are managed under org settings.
