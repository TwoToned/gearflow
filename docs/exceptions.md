# Policy Exception Register

Temporary, justified deviations from an applicable `MUST`/`SHOULD` rule in
[`POLICY.md`](../POLICY.md), per §15. Every entry **must** have: rule ID, reason, scope,
owner, and an **expiry date** (no expiry = invalid, R-15.1). Exceptions are per-instance,
never blanket (R-15.3). Reviewed at each quarterly sweep (§12); expired exceptions convert
automatically to audit failures (R-15.2).

This is **not** the place for:

- **Budget overrides** → register in the README budget table (R-0.4).
- **Permanent categorical carve-outs** (generated/vendored code) → tool-config exclusions (R-0.5).

> Findings from the baseline audit (`docs/audits/2026-07-18-hygiene-policy-baseline-audit.md`)
> are remediated directly wherever possible; the rows below are the deferrals that need a
> deliberate, dated decision rather than a code fix.

| Rule ID | Reason | Scope | Owner | Expiry |
|---------|--------|-------|-------|--------|
| R-8.1.7 | RVLT brand red (`--red` `#d8353b`) sits at ~4.41:1 against white on the primary CTA (below the 4.5:1 WCAG-AA floor), and worse for red-on-dark text. The brand palette is **accepted as-is** per DESIGN.md rather than re-toned; `color-contrast` is baselined in the axe gates (`e2e/a11y.spec.ts`, `e2e/harness-a11y.spec.ts`) so they stay deterministic and enforce every other WCAG A/AA rule. | `color-contrast` rule only, on the axe a11y gates | Jayden (design) | 2026-10-18 |
| R-8.11.2 | CSP is now split (`next.config.ts`): a zero-risk subset (`base-uri`/`object-src`/`frame-ancestors`) is **enforced**, while the full policy stays **report-only** because its `script-src`/`style-src` `'unsafe-inline'`, `form-action`, and `frame-src` directives can't be enforced without risking SAML SSO (auto-POST to the IdP) and the Google Maps iframes, and no violation-collection endpoint has yet confirmed the allowlist. Full enforcement is deferred until: (a) a CSP report endpoint (a dedicated route — Sentry, the prior CSP-report sink candidate, was removed in the PostHog migration, #650) runs in prod long enough to confirm the allowlist, and (b) the two `'unsafe-inline'` allowances are migrated to nonces. Header presence is asserted by `e2e/security-headers.spec.ts`. | The report-only directives only (the enforced subset above is live) | Jayden (security) | 2026-10-18 |
| R-8.2.2 | `@typescript-eslint/no-explicit-any` stays `warn` rather than lint-banned `error`: 137 existing `any` usages are spread across mature, working code paths, and flipping the rule to error-level in one pass would either fail every PR touching those files or force a large, high-regression-risk retyping sweep with no functional payoff. The gap is covered by a **CI-blocking ratchet** instead of an unenforced aspiration: `scripts/any-ratchet.sh` counts `: any` / `as any` in non-test `src`/`convex` source and fails the build if the count exceeds `.any-ratchet-baseline` (137) — new `any` usage cannot land, and any fix that removes one locks in the drop (the script prints the exact command). This registers that ratchet formally as the interim control until the baseline reaches 0 and the lint rule can flip to `error`. | `@typescript-eslint/no-explicit-any` lint level (`eslint.config.mjs`) + `.any-ratchet-baseline` (currently 137) for `src/**/*.{ts,tsx}` and `convex/**/*.ts`, excluding tests/generated | Jayden (eng) | 2026-10-23 |
