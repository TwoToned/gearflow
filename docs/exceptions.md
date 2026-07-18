# Policy Exception Register

Temporary, justified deviations from an applicable `MUST`/`SHOULD` rule in
[`POLICY.md`](../POLICY.md), per §15. Every entry **must** have: rule ID, reason, scope,
owner, and an **expiry date** (no expiry = invalid, R-15.1). Exceptions are per-instance,
never blanket (R-15.3). Reviewed at each quarterly sweep (§12); expired exceptions convert
automatically to audit failures (R-15.2).

This is **not** the place for:

- **Budget overrides** → register in the README budget table (R-0.4).
- **Permanent categorical carve-outs** (generated/vendored code) → tool-config exclusions (R-0.5).

> **Status: empty.** No exceptions are currently registered. The open findings from the
> baseline audit (`docs/audits/2026-07-18-hygiene-policy-baseline-audit.md`) are being
> remediated directly, not exceptioned. If a finding needs to be deferred rather than fixed,
> add a row below.

| Rule ID | Reason | Scope | Owner | Expiry |
|---------|--------|-------|-------|--------|
| _(none)_ | | | | |
