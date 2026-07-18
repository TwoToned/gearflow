# ADR-0001: Track pnpm-workspace.yaml and pin the pnpm/Node toolchain

**Status:** Accepted (2026-07-18)

## Context

The repo depends on pnpm `overrides` to force patched transitive dependencies (e.g. `ws`,
`serialize-javascript`, `hono`) that resolve security advisories. In pnpm v11, `overrides` are
read **only** from `pnpm-workspace.yaml` — the `package.json` `pnpm.overrides` field is ignored.

Previously `pnpm-workspace.yaml` was `.gitignore`d (kept as untracked per-machine config). As a
result the overrides, `allowBuilds`, and `minimumReleaseAgeExclude` settings never shipped
reproducibly: CI and the production Docker image built without them. The environments were also
skewed — CI ran pnpm 9 / Node 20 while dev and the prod image ran newer versions — which both
broke reproducibility (POLICY.md R-6.1/R-6.2) and meant the security overrides were not applied in
prod.

## Decision

1. **Track `pnpm-workspace.yaml`** (remove it from `.gitignore`). It carries the dependency
   `overrides`, `allowBuilds`, and `minimumReleaseAgeExclude`.
2. **Pin one pnpm/Node version everywhere:** `packageManager: "pnpm@11.7.0"` in `package.json`
   and `.nvmrc` = `22`. CI's `pnpm/action-setup` steps omit the `version:` input (resolved from
   `packageManager`); CI uses Node 22 (pnpm 11 requires ≥22.13); the Dockerfile installs
   `pnpm@11.7.0` and COPYs `pnpm-workspace.yaml` before `pnpm install`.

## Consequences

- Dependency overrides now ship reproducibly to CI and production; the blocking `pnpm audit`
  gate stays green.
- CI, the Docker image, and local dev use the same pnpm/Node versions (closes the R-6.2 skew).
- **Migration cost:** contributors with a local untracked `pnpm-workspace.yaml` must delete it
  before pulling, or git checkout fails ("untracked working tree file would be overwritten").
- Editing overrides now means editing `pnpm-workspace.yaml`, then running `pnpm install` so the
  lockfile's `overrides:` block matches (otherwise `--frozen-lockfile` fails).
