# 45. Error UX

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

## Overview

App-wide error handling that shows context, not raw exceptions. A `UserFacingError` type plus a Prisma-error translator turn database errors into structured `title + message + hint` toasts. Server actions surface readable failures; the client renders them consistently.

## Architecture

```
Server action throws / Prisma error
  → withAction wrapper → translatePrismaError → UserFacingError
  → crosses the server-action boundary as a plain object (toJSON)
  → client: showError(e) → structured toast (title + message + hint + retry)
```

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/errors/user-facing-error.ts` | `UserFacingError` class + `isUserFacingError` type guard |
| `src/lib/errors/prisma-translator.ts` | Maps Prisma error codes to readable messages |
| `src/lib/errors/with-action.ts` | Wraps mutating server actions, translates + re-throws |
| `src/lib/errors/index.ts` | Barrel export |
| `src/lib/show-error.ts` | Client helper — structured toast instead of `toast.error(e.message)` |

## UserFacingError

A structured error any consumer can branch on:

- `title` — 2-5 words, the failure category ("Duplicate asset tag")
- `message` — plain-English imperative sentence, no SQL or error codes
- `hint?` — optional one-liner on how to fix it
- `code` — stable `SCREAMING_SNAKE` machine code for client branching
- `field?` — form field path, lets a form surface the error next to the right input

`toJSON()` produces a `__userFacing: true` plain object so the error survives serialization across the server-action boundary. `isUserFacingError(e)` recognizes both the class instance and the serialized shape.

## Prisma Translator

`translatePrismaError(e)` turns Prisma errors into `UserFacingError`s. Example: a unique-constraint violation on `assetTag` becomes "Duplicate asset tag — that asset tag is already used. Pick a different value." Returns `null` for non-Prisma errors so the caller can re-throw the original.

## showError

Client-side, use `showError(e)` instead of `toast.error(e.message)`. It renders a structured toast: title, message, optional hint, and a retry action. Falls back gracefully on plain `Error`s.

## Migration

Existing error subclasses (`TestTagBlockError`, `InventoryError`) keep working and propagate up as-is — clients can still branch on their `code` / `name`. Asset, project, and line-item actions surface structured errors; the warehouse return page's error toasts use `showError`. The legacy `toast.error(e.message)` path remains a sensible fallback while the rest of the app migrates.
