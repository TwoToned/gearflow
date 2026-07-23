# Testing Infrastructure

## Overview

RVLT Flow uses **Vitest** for unit/integration tests and **Playwright** for E2E tests. Tests are colocated with source files (`*.test.ts` next to `*.ts`).

## Commands

```bash
npm test              # Run all unit tests once
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
npm run test:e2e      # Run Playwright E2E tests (requires running app)
npm run test:e2e:ui   # Run E2E tests with Playwright UI
```

## Configuration

| File | Purpose |
|------|---------|
| `vitest.config.ts` | Vitest config — path aliases, coverage thresholds, excludes |
| `playwright.config.ts` | Playwright config — browser targets, base URL, web server |
| `tests/helpers/setup.ts` | Vitest global setup (runs before all test suites) |

## Test Structure

Tests are colocated with source files:

```
src/lib/validations/
  asset.ts          # Source
  asset.test.ts     # Test (right next to source)
  category.ts
  category.test.ts
src/lib/
  serialize.ts
  serialize.test.ts
  permissions.ts
  permissions.test.ts
tests/
  helpers/
    setup.ts        # Global setup
```

## Coverage

Coverage is provided by `@vitest/coverage-v8`. Thresholds are set in `vitest.config.ts`:

- Statements: 70%
- Branches: 70%
- Functions: 70%
- Lines: 70%

Coverage includes `src/lib/**/*.ts` and excludes auth config, Prisma client, and generated files.

## Current Coverage

### Utility Functions
- `serialize.ts` — Prisma Decimal conversion (25 tests)
- `permissions.ts` — Role-based permission system (51 tests)

### Validation Schemas (all 20 files)
Every Zod validation schema has exhaustive tests covering:
- Valid minimal and complete data
- Required field rejection
- Max length enforcement
- Enum validation
- Default value application
- Transform behaviors (empty string → undefined)
- Refine logic (e.g., lat/lng pairs must both be present)
- Boundary values and edge cases

## E2E (Playwright)

Two CI jobs in `.github/workflows/ci.yml`:

- **`e2e`** — smoke + a11y (critical-flows #1) against a dummy Convex URL, blocking.
- **`e2e-harness`** — seeded-auth flows (critical-flows #2, #5-9: sign-in through the
  primary revenue path — project → line items → availability → check-out → return)
  against a real self-hosted Convex backend stood up in Docker
  (`scripts/e2e-harness-up.sh`). `continue-on-error: true` pending a verified green
  run on a GitHub-hosted runner. See `docs/e2e-harness.md` and
  `docs/critical-flows.md` (R-8.8.3) for the full flow list and status.

## CI Integration

The GitHub Actions deploy pipeline runs `npm test` after Prisma client generation and before migrations/build. Deploys fail fast if any test fails.

## Adding New Tests

1. Create `*.test.ts` next to the source file
2. Import from `vitest`: `import { describe, it, expect } from "vitest"`
3. Run `npm test` to verify
4. Tests are auto-discovered by Vitest via the `src/**/*.test.ts` glob

## Future Expansion

See `TODOS.md` for planned test expansion:
- Server action integration tests (priority 1)
- E2E tests with Playwright (priority 2)
- Component tests with React Testing Library (priority 3)
