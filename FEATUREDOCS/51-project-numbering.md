# Configurable Project Numbers (auto-incrementing codes)

Optional, org-configurable auto-generation of project codes from a template with
variables. Example: `%YY%MM%INC` with monthly reset → the first June 2026 project is
`260601`, the 8th July project is `260708`. Off by default — orgs that leave the format
blank keep entering codes manually exactly as before.

## Template tokens (`%`-prefixed)
| Token | Renders |
|-------|---------|
| `%YYYY` | 4-digit year (2026) |
| `%YY` | 2-digit year (26) |
| `%MM` | 2-digit month (06) |
| `%M` | month, no padding (6) |
| `%DD` | 2-digit day (05) |
| `%D` | day, no padding (5) |
| `%INCREMENT` / `%INC` / `%SEQ` | the auto-incrementing counter |

Literal text and separators are kept as-is (`GIG/%YYYY/%SEQ` → `GIG/2026/042`). A format
must contain an increment token (else every project in a period would collide) —
`validateProjectNumberFormat` enforces this in the settings UI.

## Configuration (per-org, in `Organization.metadata` JSON / `OrgSettings`)
- `projectNumberFormat` — template string; empty/undefined = auto-numbering off.
- `projectNumberIncrementReset` — `NONE | YEARLY | MONTHLY | DAILY` (default `MONTHLY`).
  Determines the counter bucket: `GLOBAL`, `2026`, `2026-06`, or `2026-06-05`.
- `projectNumberIncrementPadding` — zero-pad width for the increment (default 2).

Date tokens are computed in the org's timezone (`OrgSettings.timezone`, default the
system zone) via `datePartsInTimezone`.

## Engine (`src/lib/project-number.ts`, pure + unit-tested)
`renderProjectNumber`, `scopeKeyFor`, `validateProjectNumberFormat`, `hasIncrementToken`,
`datePartsInTimezone`, plus `PROJECT_NUMBER_TOKENS` for the UI help. Longer tokens are
substituted before their prefixes (`%YYYY` before `%YY`, `%INCREMENT` before `%INC`).
12 unit tests in `project-number.test.ts`.

## Counter storage + allocation
`ProjectNumberSequence` (`project_number_sequence`): one row per `(organizationId, scopeKey)`,
unique on that pair. Allocated inside the project-create transaction with a single
`INSERT ... ON CONFLICT DO UPDATE SET value = value + 1 RETURNING value` — race-free across
concurrent project creation. After rendering, the number is checked against existing projects
(`@@unique([organizationId, projectNumber])`); a collision with a manually-entered code bumps
the counter again (capped at 50 attempts).

## Integration points
- `createProject` (`src/server/projects.ts`): when not a template, no manual code was entered,
  AND a format is configured → allocate inside the txn (`generateProjectNumber`). If no format
  is configured and the code is blank → the existing `MISSING_PROJECT_CODE` error still fires.
  Manually-entered codes always win. Templates keep their own `generateTemplateCode` path.
- `peekNextProjectNumber(override?)` — previews the next code WITHOUT incrementing (reads the
  current counter, then probes counter+1, +2, … skipping any rendered code that's already a
  project, so the preview matches what `generateProjectNumber` will actually allocate). The skip
  matters when the counter lags the real projects (codes entered manually, imported, or created
  before auto-numbering was switched on) — without it the preview would suggest an already-taken
  code (e.g. counter 0 → `260601` when `260601`-`260603` exist). Probe-only, never persists.
  Accepts an override of unsaved `{format, reset, padding}` so the settings form previews live as
  the user types.
- Settings UI: `ProjectNumberingSettings` in Settings → Project Defaults — format input, reset
  select, padding input, token legend, and a live "Next project number" preview.
- Project create form: when auto-numbering is on, the Project Code field is optional with an
  `Auto: <next>` placeholder and a "Leave blank to auto-generate" hint.

## Duplicate-code validation (inline field error)
The `@@unique([organizationId, projectNumber])` invariant is enforced by
`createWithUniqueNumber` on insert; `createProject` turns the `{ created: false }`
result into a `DUPLICATE_PROJECT_CODE` `UserFacingError` with `field: "projectNumber"`.
**But a thrown server-action error is masked in production** to the generic
"An error occurred in the Server Components render" string — its `message`/`field`
never reach the client — so relying on the throw gave no usable inline error. Two-part fix:
- `checkProjectNumberAvailable(projectNumber, excludeProjectId?)` — a RETURN-value
  action (`{ available }`) the create/edit wizard calls before submit. Return values
  serialize across the boundary intact, so the wizard raises a client-side
  `field`-tagged error and `form.setError("projectNumber", …)` (jumping to step 0). The
  create/update throws remain the authoritative integrity backstop and feed the API
  error envelope (`toApiError` in `src/lib/api/dispatch.ts` handles `UserFacingError`).
- `updateProject` gained the same duplicate guard (it previously patched
  `projectNumber` blindly — editing a code to one a sibling already used silently
  produced two projects sharing a number). Checked only when the number actually
  changes, excluding the project's own row.

## Tests
- `project-number.test.ts` — 12 pure-engine tests (render, scopeKey, validation, tz).
- `project-numbering.int.test.ts` — 7 integration tests (sequential allocation, padding/literal,
  manual override wins, blank rejected when off, preview doesn't consume, preview skips taken
  numbers when the counter lags, override preview).
