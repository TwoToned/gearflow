# Architecture Decision Records (ADRs)

Per POLICY.md **R-5.4**: architecture decisions are recorded here as ADRs — one decision per
record, immutable once accepted, superseded (not edited) by a later ADR.

Format (Nygard): **Context · Decision · Consequences**. Status: `Proposed | Accepted | Superseded by ADR-NNNN`.

Number files `NNNN-kebab-title.md`, starting at `0001`.

| # | Title | Status |
|---|---|---|
| [0001](0001-track-pnpm-workspace-and-pin-toolchain.md) | Track pnpm-workspace.yaml and pin the pnpm/Node toolchain | Accepted |
| [0002](0002-next-image-unoptimized.md) | Adopt next/image but serve app images unoptimized | Accepted |
| [0003](0003-validation-drift-guard.md) | Enforce Zod↔Convex validation single-source via a drift guard | Accepted |
| [0004](0004-perf-regression-defect-workflow.md) | Route performance regressions through the standard defect workflow | Accepted |
