# Codebase Management & Hygiene Policy

**Version:** 2.6.2 · **Effective:** 2026-07-17 · **Owner:** Jayden Nawotka
**Applies to:** All projects, as a **default baseline plus project-specific profile** (§0.4). Stack-agnostic by design.

Changes in 2.6.2: dashboard example removed from FAIL list (no rule mandates dashboards); full clause roll-up precedence (FAIL > EXCEPTION > PASS > ADVISORY > N/A); T-P2/T-P5 reciprocal references; checklist item 2 cites §13B. **Policy frozen at this version pending real-repo trial.** Changes in 2.6.1 (closure fixes): subject-existence rule tightened (precondition vs mandated control; clause-level verdicts); §0.1 evidence principle generalized beyond [J] tags; T-21/T-25 normalized into §13B with cross-references fixed; §0 audit-mode instructions corrected; SLSA claim narrowed; DORA link and LICENSE-finding scope fixed. (2.6.0: subject-existence N/A, ADVISORY verdict + scoring, §13B, [J] repairs, security-emergency bypass, opaque-ID carve-out, backup retention, SLSA/[STD] honesty, DORA five metrics, proprietary rights rule.) (2.3.0: ADVISORY term, §8 activation table, report redaction, GitFlow citation.) (2.2.x: ○ semantics, registration binds value not level, R-9.1 machine/process split, §8.11/§8.12 conditions, exhaustive PROTO footnote, §13 wording alignment.) (2.1.x: explicit matrix, applicable-threshold scoping, PROTO secrets path, hot-path indexing, R-9.2 budget types, CSRF tokens/origin, WCAG evidence, living-guidance labels, patch SLAs. 2.0.0: profiles, evidence criteria, call efficiency §9B, registered budgets, §8.11 security, §8.12 privacy, accessibility, adoption checklist, versioned sources.)

---

## 0. How to use this document

**BUILD mode** — When writing new code (human or Claude Code), every applicable rule marked MUST is a hard constraint. Code that violates an applicable MUST rule is defective and may not be merged, regardless of whether it works.

**AUDIT mode** — When auditing a codebase: (1) determine the project's profile (R-0.1); (2) walk every rule applicable to that profile; (3) record PASS / FAIL / ADVISORY / N/A / EXCEPTION per rule (or per clause, where R-14.1 permits clause-level verdicts) using the rule's evidence criterion. Section 14 defines procedure and report format.

### 0.1 Conformance language

Per RFC 2119/8174: **MUST** / **MUST NOT** = absolute requirement for the applicable profile; violations block merge and are audit failures. **SHOULD** / **SHOULD NOT** = required unless a documented, justified exception exists (§15). **MAY** = optional. **ADVISORY** = non-blocking guidance produced only by ○ profile downgrades (R-0.2); advisory findings do not require §15 exceptions and are not audit FAILs. **[J]** marks rules where judgment dominates the verdict, and these carry explicit evidence criteria. The governing principle is broader than the tag: **any materially subjective finding — under a [J]-marked rule or not — MUST quote the code/doc it concerns and state its reasoning.** Subjective findings are never silent failures; the [J] tag flags where to expect them, it does not exhaust where they occur.

**Interpretation clause:** within a numbered rule, declarative statements without a modal verb ("lockfiles committed; CI installs in frozen mode") inherit the strongest modal used in that rule; a rule containing no modal at all is read as MUST throughout. Auditors MUST apply this clause rather than treating modal-free statements as ambiguous or optional.

### 0.2 Provenance tags

- **[STD]** — The rule's content derives from a formal standard or equivalent published specification (ISO/IEC, IEEE, NIST, W3C, OWASP-published, or OpenSSF-published such as SLSA), cited in Appendix A with version. Where a rule *operationalizes* a source as a gate (e.g., ISO 5055-aligned static analysis as a CI blocker, NIST's complexity 10 as a lint error), the gate itself is this policy's choice informed by the standard — the standard defines the measure, not the enforcement.
- **[BP]** — Established industry best practice with broad consensus. No formal standard exists.
- **[CONV]** — A numeric threshold that is convention, not standard. Defensible and widely cited, but a **default**: repos register their own value per R-0.4.

### 0.3 Rule numbering

Rules are numbered `R-<section>.<n>`. Cite rule IDs in reviews, in commits resolving violations, and in audit reports.

### 0.4 Project profiles

- **R-0.1** Every repository MUST declare exactly one profile in its README (or `POLICY.md`): **LIB** (library/package), **CLI** (tool/scripts), **PROTO** (prototype/spike), **INT** (internal app), **WEB** (production web/app service), **REG** (regulated, payments, or high-sensitivity data). An undeclared profile defaults to WEB for audit purposes. A repo that meets REG criteria (handles payments, regulated data, or high-sensitivity personal data) MUST declare REG regardless of what else it is.
- **R-0.2** Applicability matrix. ● = required: inner rules apply at their stated conformance level. ○ = recommended: every inner rule downgrades to **ADVISORY** — a distinct conformance level below SHOULD. ADVISORY rules are exempt from §15 exception requirements; non-conformance is recorded as an advisory finding only, never a merge blocker or audit FAIL. (This is deliberate: a SHOULD created by downgrade would otherwise still demand documented exceptions, defeating the downgrade.) ◐ = required (at stated levels) where the stated condition holds, else N/A. — = N/A. Every cell is explicit; auditors record N/A per rule where a ◐ condition is absent:

| Section | LIB | CLI | PROTO | INT | WEB | REG |
|---|---|---|---|---|---|---|
| §2 Repo & version control | ● | ● | ●¹ | ● | ● | ● |
| §3 DRY & modularity | ● | ● | ○ | ● | ● | ● |
| §4 Dead & stale code | ● | ● | ○ | ● | ● | ● |
| §5 Documentation | ● | ● | ●¹ | ● | ● | ● |
| §6 Dependencies & supply chain | ● | ● | ○ | ● | ● | ● |
| §7 Secrets & source access | ● | ● | ●² | ● | ● | ● |
| §8.1–8.10 Category rules | ◐ | ◐ | — | ◐ | ◐ | ◐ |
| §8.11 Web security hardening | ◐⁴ | ◐⁴ | ○⁴ | ◐⁴ | ◐⁴ | ◐⁴ |
| §8.12 Privacy & data handling | ◐³ | ◐³ | ○³ | ◐³ | ◐³ | ◐³ |
| §9A/§9B Efficiency & calls | ○ | ○ | — | ● | ● | ● |
| §10 CI/CD gates | ● | ● | ○ | ● | ● | ● |
| §11 Metrics | ○ | ○ | — | ○ | ● | ● |
| §12 Quarterly sweep | ● | ● | — | ● | ● | ● |

¹ Exhaustive PROTO subset: within §2, only R-2.1 (README, `.gitignore`, lockfile) and R-2.2 apply as MUST; within §5, only R-5.3 (no docs contradicting code) applies as MUST. All other §2/§5 rules are ○ (downgraded) for PROTO.
² PROTO without CI satisfies R-7.3 via pre-commit scanning + platform push protection; CI-layer scanning becomes mandatory at graduation.
³ Condition: the project handles personal data; otherwise N/A (○³ = recommended even then, only if personal data is handled).
⁴ Condition: the project exposes HTTP endpoints (serves web pages or APIs) — including a LIB shipping an HTTP service module or a CLI embedding an HTTP server; HTTP is HTTP regardless of profile. Non-HTTP projects record §8.11 as N/A, except R-8.11.4 (audit logs) and R-8.11.5 (backups), which apply wherever production data exists.

- **R-0.3** PROTO is time-boxed: the README MUST state an expiry date ≤ 90 days out. At expiry the repo is either deleted, or graduated to a full profile and brought into compliance. An expired PROTO is an audit failure in its entirety.
- **R-0.4** **Budget registration:** every **applicable** [CONV] threshold in §13 is a default (a threshold is applicable only when its parent rule applies under R-0.2 — e.g., no CWV budget without a frontend, no reconciliation cadence without billing). Each repo MUST either accept the applicable defaults (stating so once in README/`POLICY.md`) or register overriding values with one-line rationales in its own threshold table. Registration binds the **value**, not the conformance level: a registered threshold is enforced at the level of the rule that cites it (T-2 PR size and T-3 review response remain SHOULD after registration; T-8 bundle cap remains MUST). Registration never elevates a SHOULD rule to a hard gate. Applicable + unregistered + non-default = audit failure; inapplicable thresholds are recorded N/A.
- **R-0.5** **Exclusions:** generated code, vendored third-party code, lockfiles, migrations, and test fixtures are excluded from length (R-3.7), duplication (R-3.3), naming (§3.3), coverage (R-8.8.2), and docs-ownership (R-5.5) rules. Exclusions MUST be declared in tool configuration (lint/coverage ignore files), never applied ad hoc during an audit. Generated files MUST be marked as generated (header comment or `.gitattributes linguist-generated`).

---

## 1. Standards alignment

This policy aligns with the following formal standards and published specifications (exact versions/URLs in Appendix A). Where a section derives from one, the section header notes it. Everything else is best practice, tagged accordingly.

| Standard | What it provides here | How this policy uses it |
|---|---|---|
| **ISO/IEC 25010:2023** | Maintainability taxonomy: **modularity, reusability, analysability, modifiability, testability** | Structural vocabulary for §3 and the quality goals of the whole policy |
| **ISO/IEC 5055:2021** | CWE-based automated source-code quality measures | Justifies mandatory static-analysis CI gates (§10); rulesets SHOULD reference ISO 5055/CWE |
| **NIST SP 500-235** | Cyclomatic complexity limit 10 (15 with justification) | §3.6 / T-1 |
| **ISO/IEC 5230:2020** (OpenChain) | OSS license-compliance program requirements | §6 licensing; self-certifiable by small teams |
| **ISO/IEC 27001:2022** Annex A 8.4/8.25/8.28 | Source access control, secure SDLC, secure coding | §7; control content adopted without requiring ISMS certification |
| **OWASP ASVS 5.0.0** & **OWASP Top 10:2025** | Verifiable app-security requirements | §7, §8.4, §8.11, §6 (A03 supply chain) |
| **WCAG 2.2 AA** (W3C) | Accessibility conformance | R-8.1.7 |
| **SLSA v1.2 / OpenSSF Scorecard** | Supply-chain integrity; repo-hygiene scoring | §6, §10 |
| **SemVer 2.0.0, Conventional Commits 1.0.0, Keep a Changelog 2.0.0** | Versioning, commit grammar, changelog format | §2 |
| **ISO/IEC/IEEE 12207, 90003, 26514/15289, SWEBOK v4** | Life-cycle, QMS, documentation standards | Definitions only. Full compliance is enterprise/regulated territory and **explicitly not required**. §5 uses docs-as-code + Diátaxis [BP] as the practical substitute. |

Where no standard applies cleanly (repo layout, PR size, file length, coverage %, budgets), this policy relies on well-established practice via [BP]/[CONV] tags.

---

## 2. Repository structure & version control

### 2.1 Required root files [BP]

- **R-2.1** Every repository MUST contain: `README.md`, a rights declaration (`LICENSE` for open-source/distributed code; a proprietary notice or `RIGHTS.md` for closed repos — a *project-level* OSS `LICENSE` that incorrectly purports to license proprietary first-party code is a finding; vendored/third-party license files and per-package licenses in mixed-license monorepos are fine), `.gitignore`, `.editorconfig`, and a committed lockfile per ecosystem (applications). Public/multi-contributor repos MUST also contain `CONTRIBUTING.md` and `SECURITY.md`; repos with review routing MUST contain `CODEOWNERS`.
- **R-2.2** `README.md` MUST state: what the project is, its policy profile (R-0.1), how to install/run/test it, the repository layout (no ISO standard for layout exists, so it MUST be documented rather than assumed), and where further docs live. Missing any element = FAIL.
- **R-2.3** A `CHANGELOG.md` following Keep a Changelog (Added/Changed/Deprecated/Removed/Fixed/Security, ISO dates, Unreleased section) MUST exist for any versioned/released artifact. [CONV]
- **R-2.4** Released artifacts MUST version per SemVer 2.0.0. [CONV]

### 2.2 Branching & commits [BP]

- **R-2.5** Trunk-based / short-lived-branch flow MUST be used: feature branches merge to a protected default branch within the T-16 age budget (default 3 days). Long-lived divergent branches (GitFlow-style) MUST NOT be used unless multiple supported release lines genuinely exist (§15 exception). Basis: DORA research; Atlassian classifies GitFlow as legacy.
- **R-2.6** The default branch MUST be protected: no direct pushes, required status checks (§10), no force-push. Merged branches MUST be deleted.
- **R-2.7 [J]** Commits MUST be atomic (one logical change) with imperative subjects. Conventional Commits grammar SHOULD be used where changelog/release automation exists. *Evidence:* a non-atomic finding cites a commit touching unrelated subsystems/concerns and names them. [CONV]
- **R-2.8** Pull requests SHOULD be ≤ 400 changed LOC (T-2, target 200–400), excluding R-0.5 exclusions. *Review-rate guidance (not a gate):* reviewers should not sustain > ~500 LOC/hour; sessions ≤ 60–90 min. [CONV — SmartBear/Cisco study]
- **R-2.9** *Review guidance, not an audit gate:* approve when the change **definitely improves overall code health**, even if not perfect (Google eng-practices). The auditable clause: first review response SHOULD come within 1 business day (T-3). [BP]

---

## 3. DRY, modularity & code structure

Vocabulary per ISO/IEC 25010:2023 maintainability. [STD]

### 3.1 DRY — single source of truth [BP]

- **R-3.1 [J]** Every piece of **knowledge** (business rule, data shape, permission definition, price, validation constraint, design token, configuration value) MUST have exactly one authoritative definition. A second hand-maintained definition of the same knowledge is a defect even if currently in sync. *Evidence:* the finding names both definition sites (file:line) and states the shared fact they encode; greps for duplicated literals/schemas/constants and duplicate-code detection (jscpd, PMD CPD, SonarQube) supply candidates.
- **R-3.2 [J]** DRY applies to knowledge, not incidental textual similarity. Look-alike blocks encoding different decisions MUST NOT be merged. *Evidence:* to reject a proposed merge, the finding states the distinct decisions each copy encodes.
- **R-3.3** **Rule of three:** implementation duplication is tolerated twice; the third occurrence MUST be extracted. *Evidence:* duplicate-detection tool report or three cited sites. [CONV — Fowler]
- **R-3.4 [J]** **Wrong-abstraction escape hatch:** a shared abstraction accreting parameters and caller-specific conditionals MUST be re-inlined rather than extended (Metz/AHA). Preferring duplication is compliant only when recorded as a TODO with owner. *Evidence:* the conditional/parameter growth is cited from the abstraction's diff history or signature.

### 3.2 Modularity [BP]

- **R-3.5** Modules MUST have an explicit public interface; internal symbols MUST NOT be imported across module boundaries; dependency direction MUST be acyclic. *Evidence (mechanical):* an import-lint tool (dependency-cruiser, import-linter, ArchUnit, Nx boundaries) is configured in CI and reports zero cycle/boundary violations. Single-responsibility judgment beyond that is reviewer-checklist [J]: a finding quotes the module's unrelated responsibilities.
- **R-3.6** Cyclomatic complexity per function ≤ 10; ≤ 15 only with a justification comment at the function. Lint-enforced. [STD — NIST SP 500-235]
- **R-3.7** Function length SHOULD be ≤ 60 lines; file length ≤ 400 lines (T-4; R-0.5 exclusions apply). The thresholds are SHOULD-level; what is MUST is that the repo's registered values exist in lint configuration (warn-level acceptable). A length violation is a SHOULD-level finding unless the repo has promoted its lint rule to error. [CONV]
- **R-3.8 [J]** New code MUST reuse an existing module/component where one exists for the purpose; a parallel implementation of an existing capability is review-blocking. *Evidence:* the finding names the pre-existing module and states the overlapping capability.

### 3.3 Naming conventions [BP]

- **R-3.9** The repo MUST declare its casing/format conventions per artifact type — files/directories, variables, functions, types/classes, constants, DB tables/columns, env vars, event names — either explicitly (README/`CONTRIBUTING.md`) or by stating "ecosystem defaults" and naming the ecosystem. Conventions MUST be lint-enforced where tooling exists for the language (naming-convention lint rules, schema linters); elsewhere they are review checklist items. *Evidence:* declaration present + lint config, or a cited inconsistency (two artifacts of the same type, different conventions).
- **R-3.10 [J]** **One name per domain concept** (R-3.1 applied to vocabulary): the same entity/concept MUST use the same term everywhere — code, schema, docs, UI copy where feasible. `client` in one module and `customer` in another for the same entity is a defect. Intentional aliases are permitted only when documented in the glossary with the mapping and reason (e.g., UI copy uses customer-friendly wording while code uses the domain term); an undocumented alias remains a defect. Projects with more than a handful of domain terms SHOULD keep a glossary in-repo. *Evidence:* grep for synonym pairs across layers; the finding cites both sites and states the shared concept.
- **R-3.11 [J]** Names MUST describe current behavior (generalizes R-8.10.2 beyond adapters): a function, flag, module, or column whose name no longer matches what it does is stale documentation-in-code — rename, with an R-4.4 deprecation window if callers need time. Booleans and predicates SHOULD read as assertions (`isActive`, `hasAccess`); units belong in the name or type where ambiguity is possible (`timeoutMs`, `Duration`).
- **R-3.12 [J]** Names MUST communicate intent: single-letter names (outside idiomatic scopes like loop indices and lambda parameters), unexplained abbreviations, and meaningless names (`data2`, `tmp`, `doStuff`, `Manager`/`Util` catch-alls) are findings. *Evidence:* the finding quotes the name, its scope, and why the name fails to communicate; idiomatic exceptions (`i`, `ctx`, `req/res`, ecosystem norms) are not findings.

---

## 4. Dead & stale code

- **R-4.1** Commented-out code MUST NOT be committed. Version control is the archive. [BP]
- **R-4.2** Unused exports, unreachable code, unused files, and unused dependencies MUST be detected automatically (Knip, Vulture, `go mod tidy`, cargo-udeps, warnings-as-errors) in CI. New violations fail the build; pre-existing ones go on an owned burn-down list. [BP]
- **R-4.3** Every feature flag has an owner and expiry/removal condition at creation; flags removed within 30 days of 100% rollout (T-6); quarterly flag audit. [CONV]
- **R-4.4** Compatibility-only code (legacy adapters, deprecated endpoints, renamed-but-retained functions) MUST carry a deprecation marker with a removal condition. Each audit checks every marker: condition met → removal is a required finding.
- **R-4.5** Migration residue MUST be cleaned up: when a system migration completes, superseded access paths, config, and dependencies are removed via a scheduled task, not left indefinitely. "Kept so callers don't change" is acceptable only with an R-4.4 marker and date.

---

## 5. Documentation

Basis: docs-as-code + Diátaxis + ADRs [BP]. ISO/IEC/IEEE 26514/15289 apply only to regulated deliverables.

- **R-5.1** Docs live in-repo, plain-text markup, reviewed through the same PR pipeline. Out-of-repo docs for in-repo behavior SHOULD NOT exist; where unavoidable, the repo links to them and names an owner.
- **R-5.2** **Docs update in the same PR:** any PR changing behavior, architecture, configuration, or interfaces MUST update every affected document in that PR. "Docs later" is non-compliant.
- **R-5.3** **Stale docs are defects, equal in severity to stale code.** Any doc statement contradicted by current code MUST be corrected or deleted when found, by the finder, in the current PR or immediate follow-up. *Evidence:* audits grep docs for names of removed/replaced technologies and patterns.
- **R-5.4** Architecture decisions are recorded as ADRs in-repo: one decision per record, Context/Decision/Consequences, immutable once accepted, superseded not edited. [BP]
- **R-5.5** Every document has an owner and last-reviewed date (R-0.5 exclusions apply). Critical docs (architecture, onboarding, runbooks) reviewed at least quarterly (T-14); review updates the date even if nothing changed. [CONV]
- **R-5.6** Docs SHOULD organize by Diátaxis mode once a project exceeds ten documents. Reference material derivable from code (API/schema docs) MUST be generated, not hand-maintained. [BP]
- **R-5.7** CI SHOULD run a link checker; executable doc examples SHOULD be tested.
- **R-5.8** Agent instruction files (`CLAUDE.md`, `AGENTS.md`, cursor rules) are documentation subject to R-5.2/R-5.3: they MUST accurately reflect current commands, package manager, structure, and conventions.

---

## 6. Dependencies & supply chain

Basis: OpenSSF, OWASP Top 10:2025 A03, SLSA v1.2, ISO/IEC 5230. [STD/BP]

- **R-6.1** One package manager **per ecosystem** within the repo (e.g., one JS manager, one Python manager), documented at repo root. Competing managers or lockfiles for the same ecosystem are prohibited. Lockfiles committed; CI installs in frozen/ci mode failing on drift.
- **R-6.2** Runtime and package-manager versions pinned in-repo (engines/toolchain/`.nvmrc`/`packageManager`) so local, CI, and production match. Version skew between environments is a finding.
- **R-6.3 [J]** Adding a dependency requires verifying the platform/stdlib cannot do it and recording the justification in the PR. Micro-deps duplicating platform APIs MUST NOT be added. *Evidence:* the mechanical check is the justification's presence in the PR; a challenge to its substance names the platform API that suffices. [BP]
- **R-6.4** Zero unused dependencies (enforced by the §4 scanner).
- **R-6.5** Automated update bot (Renovate/Dependabot) enabled. Security patch SLA: critical ≤ 24 h, high ≤ 72 h (unless exceptioned per §15); routine updates batched at intervals of ≤ 14 days (T-12). [CONV]
- **R-6.6** Zero known critical/high vulnerabilities at merge; exceptions documented and expiring. [BP]
- **R-6.7** Supply-chain hardening where the ecosystem supports it: minimum release age ≥ 24 h; lifecycle/install scripts disabled by default with allowlist; CI actions and images pinned to digests. **Security-emergency bypass:** the minimum release age MAY be waived for a patch remediating an actively exploited vulnerability, provided provenance is verified (official maintainer/registry release) and the waiver is logged in the exception register — this resolves the edge where the R-6.5 24 h critical-patch SLA meets a release younger than 24 h; absent active exploitation, the release-age gate wins and the SLA clock tolls until it passes. [BP — OpenSSF]
- **R-6.8** License compliance per ISO/IEC 5230 principles: allow/deny list checked in CI; SBOM (SPDX/CycloneDX) producible on demand (MUST for LIB/WEB/REG; SHOULD otherwise). [STD]

---

## 7. Secrets & source access

Basis: ISO/IEC 27001:2022 A.8.4/A.8.28, OWASP Secrets Management. [STD] Applies in full to every profile including PROTO.

- **R-7.1** No **active or unrotated** secret may exist in current content or anywhere in history. Any historical exposure MUST have rotation evidence and a documented incident/remediation record (in-repo or linked). A rotated, documented historical leak is compliant; an unrotated one is a Critical finding regardless of age.
- **R-7.2** `.env`-style files gitignored; committed `.env.example` lists every required variable name (no values). Config schema-validated at startup, failing fast.
- **R-7.3** Secret scanning at two layers minimum: pre-commit (Gitleaks or equivalent) and CI/PR (PROTO without CI: pre-commit + platform push protection suffice until graduation, per R-0.2 note ²). Full-history sweeps (TruffleHog or equivalent) MUST run at least quarterly (§12). Platform push protection enabled where offered.
- **R-7.4** Production secrets live in a secret manager/platform store, injected at runtime — never build-time embedded, never in client bundles. Long-lived credentials SHOULD move to short-lived/scoped as maturity allows; REG: key rotation schedule documented and evidenced.
- **R-7.5** Write access to source restricted and auditable (branch protection + review satisfies this for small teams). REG: access reviewed quarterly with a recorded reviewer.

---

## 8. Category requirements (stack-agnostic)

Each subsection names a *category*; the reference stack is an example only. Map the project's actual tools onto categories, then apply the rules (§14.3). Rules are [BP] unless tagged; efficiency requirements are MANDATORY where the section applies (§0.4).

**Category activation table.** A ◐ category is active if and only if its trigger holds. Activating a category applies that category's rules; it does NOT change the repo's profile — the profile changes only if R-0.1 criteria independently require it (e.g., payments activate §8.5 in any profile; they also independently make the repo REG under R-0.1's definition).

**Subject-existence rule:** a rule's *subject* is an **independently existing precondition** — a system, artifact class, or activity the project either has or doesn't, whose existence is not itself demanded by any rule (a database, a deploy pipeline, a queue, payments). Within an active category, a rule whose subject is absent is recorded N/A — activation never obliges creating the subject. **The absence of a control this policy mandates is never a missing subject — it is a FAIL** (no audit log where R-8.11.4 applies is a FAIL, not N/A; same for missing backups, error capture, or scanners). Mixed rules take **clause-level verdicts**: a typed repo with no database records R-8.2.4's schema-codegen clause N/A while its other clauses are judged normally; a non-deployable library records R-8.8.3's deploy-blocking clause N/A (its critical-flows list covers its public API instead). Every N/A names the absent precondition, so N/A claims are themselves checkable.

| Category | Trigger |
|---|---|
| §8.1 Frontend | The repo ships UI rendered in a browser/webview |
| §8.2 Language/type | The primary language has a static/gradual type system available |
| §8.3 Backend/DB | The repo owns a persistence layer (DB, document store, durable KV) |
| §8.4 Auth | The repo authenticates users or issues/validates sessions or tokens |
| §8.5 Billing | The repo initiates, records, or reacts to payments or subscriptions |
| §8.6 Forms/validation | The repo accepts structured user or API input |
| §8.7 UI/styling | §8.1 active, or the repo defines a design system/tokens |
| §8.8 Testing | Always active where §8 applies at all |
| §8.9 Observability | The repo has at least one deployed runtime |
| §8.10 Integrations | The repo calls any third-party service via SDK or API |
| §8.11 Web security | Note ⁴ (HTTP exposure; audit-log/backup carve-out) |
| §8.12 Privacy | Note ³ (personal data) |

### 8.1 Frontend framework layer
*(Next.js/React, Nuxt/Vue, SvelteKit, or any UI framework)*

- **R-8.1.1** Server-first rendering where the framework supports it; interactivity isolated into leaf client components. *Auditable condition:* a client/hydration boundary on a route/layout root MUST carry a justification comment; a client boundary whose subtree contains no interactivity is a defect.
- **R-8.1.2** Rendering strategy chosen per route; independent data fetches parallelized — request waterfalls are defects. *Evidence:* sequential awaits on independent fetches, cited.
- **R-8.1.3** Heavy optional widgets MUST be code-split/dynamically imported. *Definition (auditable):* any dependency > 50 KB compressed that is not needed for first paint of the route.
- **R-8.1.4** Every image/video/iframe declares dimensions; images use the framework's optimizing primitive, modern formats, lazy-load below fold, priority hints on the LCP element. Fonts self-hosted, subset, swap/size-adjusted fallback.
- **R-8.1.5** **Efficiency gates:** CWV at p75 meet LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 (T-7), alerting at 80%. Critical-path JS SHOULD be ≤ 170 KB compressed per route and MUST be ≤ 300 KB (T-8), enforced by a CI bundle check failing on regression. [CONV]
- **R-8.1.6** State: local by default; server data in the query/loader layer, not global stores; prop drilling beyond 3 levels (T-20) resolves by composition first, context second.
- **R-8.1.7** **Accessibility [STD — WCAG 2.2 AA]:** WCAG 2.2 AA is the conformance target: full keyboard operability, visible focus states, accessible names on interactive elements, contrast ≥ 4.5:1 (text), reduced-motion respected. *Evidence:* automated axe/Playwright-axe checks in CI (zero violations on covered pages) plus a manual WCAG checklist pass on critical flows per release. Automated checks alone do NOT demonstrate full AA conformance and MUST NOT be reported as such.

### 8.2 Language / type layer
*(TypeScript strict, mypy --strict, Sorbet, or any gradual typing)*

- **R-8.2.1** Strict mode on, never globally weakened. Zero type errors in CI.
- **R-8.2.2** Untyped escape hatches (`any`, `# type: ignore`, `@ts-ignore`) lint-banned; described `@ts-expect-error`-style suppressions only, count ratcheted (never grows).
- **R-8.2.3** Every trust boundary (HTTP body, form, webhook, env, third-party response, queue message) parsed through a runtime schema with the static type **inferred from the schema**. [BP; supports OWASP ASVS input validation — STD]
- **R-8.2.4** A data shape is declared once: DB schema → generated types → shared domain types. A duplicated interface for the same entity in another layer is a defect (R-3.1 applied to types).

### 8.3 Backend / database layer
*(Convex, Prisma/Drizzle, ActiveRecord, Django ORM, SQLAlchemy, raw SQL)*

- **R-8.3.1** Schema definition is the single source of truth; 100% of schema changes via versioned committed migrations; no manual DDL in production; CI fails on drift.
- **R-8.3.2** N+1 prohibition: no query inside a loop; joins/includes/batch loaders. Slow-query detection enabled with the repo's registered latency budget (T-9 default: interactive-path p95 < 100 ms; interactive query > 1 s = incident). Analytics/batch/report paths register their own budgets per R-0.4 — the default applies to interactive request paths only.
- **R-8.3.3 [J]** Indexing: every FK/relation column indexed. Every **production/hot-path query** uses indexed access, with the supporting index shipped **in the same PR** as the query that introduces it. *Evidence:* schema index list vs committed query sites, or query plans for contested cases. Documented exemptions (comment at the query or schema) are permitted for tiny tables, low-cardinality fields an index wouldn't help, and write-heavy tables where the index cost exceeds its benefit — compound-index column order is a review point, not a mechanical check. Reactive/document backends: filters use indexes, never full-table scans; unbounded collection reads on growable tables banned — paginate or narrow.
- **R-8.3.4** One data-access layer per entity; the same access pattern re-implemented at multiple sites is copy-paste debt (R-3.1/R-3.3).
- **R-8.3.5** Multi-write invariants inside explicit transactions; transactions short, no network calls inside. Reactive backends: granular queries so invalidation is narrow.
- **R-8.3.6** One client/pool instance per process; serverless uses a pooler with deliberately sized limits.
- **R-8.3.7** **Dual-backend rule:** where two persistence systems coexist, each table/collection has exactly one documented owning system; dual-writes prohibited outside an explicitly scoped migration window with an R-4.4 marker.

### 8.4 Authentication & authorization
*(Better Auth, Auth.js, Clerk, Auth0, Devise, framework auth)* — Basis: OWASP ASVS 5.0.0 / Top 10:2025 A07. [STD]

- **R-8.4.1** Hand-rolled password hashing, token issuance, session storage, or crypto prohibited.
- **R-8.4.2** Authorization enforced server-side on **every** request/mutation; client checks are UX only. One shared guard/middleware; endpoints MUST NOT re-implement it. *Evidence:* grep for endpoints not calling the guard; a CI test asserting "no unauthenticated mutation reachable" SHOULD exist.
- **R-8.4.3** Every mutation re-verifies object-level authorization (IDOR defense).
- **R-8.4.4** Roles/permissions defined in exactly one module; UI, API, DB rules read from it; duplicated permission literals fail review.
- **R-8.4.5** Sessions: CSPRNG IDs, ≥ 64 bits entropy, ≥ 128-bit length [STD — OWASP], regenerated at login, Secure/HttpOnly/SameSite cookies, never in URLs, idle + absolute timeouts, invalidated on logout. Cookie flags asserted in an integration test.
- **R-8.4.6** Server-side rate limiting on auth endpoints; MFA available for privileged roles.

### 8.5 Billing / payments
*(Stripe, Paddle, LemonSqueezy, Braintree)* — REG rules; apply wherever payments exist.

- **R-8.5.1** Webhooks: 100% signature verification; idempotent handlers (event-ID dedupe with unique constraint, processing in the same DB transaction).
- **R-8.5.2** The webhook — never the redirect URL — is the source of truth for payment completion; never trust ordering; refetch the live object from the provider.
- **R-8.5.3** No monetary amount ever originates from the client; client sends at most a plan/price identifier. Greppable; review-blocking.
- **R-8.5.4** All provider SDK calls in one billing module (lint-restricted imports); entitlements read from your own DB projection of subscription state.
- **R-8.5.5** Reconciliation job diffing provider vs local state at least daily (T-18); discrepancies alert.

### 8.6 Forms & validation

- **R-8.6.1** One schema per form/entity in a shared module, used by BOTH client resolver and server handler. A second hand-maintained validation of the same fields is a defect.
- **R-8.6.2** Server always re-validates; client validation is UX.
- **R-8.6.3** Variants derive by schema transformation (pick/omit/partial), never re-declaration; coercion/normalization in the schema.
- **R-8.6.4** Zero endpoints accepting unvalidated bodies — enforced via a typed handler wrapper requiring a schema argument.

### 8.7 UI / styling system

- **R-8.7.1** Design tokens defined in exactly one place; semantic tokens only in app code; hard-coded color/spacing literals outside the token file are lint failures. Test: a brand-color change is a one-line diff.
- **R-8.7.2** Shared primitives built once on the accessibility/headless layer; duplicate primitive implementations review-blocking. Mixed primitive families permitted only with a documented convention stating which family owns which component class.
- **R-8.7.3** A class-string cluster appearing 3+ times MUST become a component or variant (CVA-style) (R-3.3 applied to styling).
- **R-8.7.4** Dead styles deleted with their component (§4 scan covers unused variants/orphaned CSS); theming flows through tokens only.
- **R-8.7.5** CSS included in the T-8 size budget (purged CSS ≤ 50 KB compressed default). [CONV]

### 8.8 Testing

- **R-8.8.1** Shape: types+lint base; many fast unit tests; integration as the widest paid band; few E2E for critical flows. Tests colocated; test public behavior, not implementation.
- **R-8.8.2** Coverage ≥ 80% line coverage over the repo's **declared core-logic scope** as a **ratchet** (never decreases; R-0.5 exclusions apply); the scope (directories/globs constituting business logic) MUST be declared in coverage config so the number is reproducible; diff-coverage gating preferred; 100% is explicitly not a goal (T-5). [CONV — Google bands]
- **R-8.8.3** New code requires tests in the same PR. The repo MUST maintain a **critical-flows list** (in README or test docs); the E2E smoke suite MUST cover 100% of that list — at minimum auth and the primary revenue path where they exist — running on and blocking every deploy. An E2E scaffold with zero tests while a critical-flows list exists (or should) is an audit failure. *Evidence:* flows list vs E2E test inventory.
- **R-8.8.4** Flaky tests: zero tolerance via quarantine — immediate quarantine to non-blocking suite with owner + ticket + deadline; fixed or deleted within one sprint (T-19); max quarantine size registered (T-P5). No hard sleeps in E2E; auto-waiting assertions; CI retries ≤ 2 with trace-on-retry (T-15).
- **R-8.8.5** Speed: unit suite < 2 min (T-17); full PR pipeline within T-11.

### 8.9 Observability
*(Sentry/Rollbar/Datadog + logging/tracing generally)*

- **R-8.9.1** Every deployable runtime (browser, server, edge, jobs, cron) initializes error capture. A runtime without it is an audit failure — check for missing per-runtime config.
- **R-8.9.2** Release + environment tagging and source-map/symbol upload are mandatory pipeline steps; a deploy without them fails.
- **R-8.9.3** Alert hygiene: alert on thresholds/regressions, never "every new issue"; recurring un-actioned alerts removed or fixed; alert rules audited on schedule; zero standing ignored alerts. Every paging alert has a linked runbook.
- **R-8.9.4** Errors carry context — **opaque internal user ID** (pseudonymous key, never name/email/phone), request ID, flags; all other PII scrubbed at SDK level; new production issues acknowledged within 1 business day (T-19); crash-free floor ≥ 99.5% (T-13). This is the sanctioned carve-out from R-8.12.4: the opaque ID is permitted in error/observability tooling under access control because it identifies only via a lookup the tooling doesn't contain. [CONV]
- **R-8.9.5** **Structured logging:** logs are structured (JSON or equivalent), levelled, and carry a correlation/request ID propagated across services and into error reports. Sensitive data (credentials, tokens, PII per §8.12) MUST NOT be logged; a log-scrubbing test or lint SHOULD exist.
- **R-8.9.6** Cross-service calls carry trace context (W3C traceparent or platform equivalent) where more than one service exists. Dashboards have named owners; WEB/REG register per-endpoint latency SLOs for interactive endpoints (T-P6) and alert on breach.

### 8.10 External integrations
*(email, storage, PDF, SMS, maps, analytics — any vendor SDK)*

- **R-8.10.1** One adapter module per external service; only the adapter imports the vendor SDK (restricted-import lint). Swap test: replacing the vendor touches only adapter + config.
- **R-8.10.2** Adapter names reflect the current implementation; names referencing decommissioned vendors are stale documentation-in-code — rename with an R-4.4 window if callers need time.
- **R-8.10.3** Vendor responses are untrusted input — schema-validate (R-8.2.3). Retry/rate-limit/circuit-breaker policy lives in the adapter; side-effecting calls use idempotency keys where supported. Call-level budgets per §9B.
- **R-8.10.4** Templates (email/PDF/docs) in one place with typed inputs; no inline markup strings in feature code. Each adapter has a fake/local implementation for tests and dev.

### 8.11 Web security hardening
*(INT/WEB/REG — anything serving HTTP)* — Basis: OWASP ASVS 5.0.0, Top 10:2025. [STD]

- **R-8.11.1** Every cookie-authenticated state-changing endpoint MUST verify anti-CSRF tokens (framework-provided) **or** validate the Origin/Referer header against an allowlist; SameSite=Lax/Strict is required defense-in-depth but is NOT sufficient alone. CORS is deny-by-default with an explicit origin allowlist — `*` with credentials is prohibited.
- **R-8.11.2** Security headers set and verified by an integration test or scanner: Content-Security-Policy (no `unsafe-inline` script without nonce/hash justification), HSTS, X-Content-Type-Options, Referrer-Policy, frame-ancestors. All traffic TLS; HTTP redirects to HTTPS.
- **R-8.11.3** Injection defense beyond schema validation: parameterized queries only (no string-built SQL/NoSQL); context-appropriate output encoding for user content (HTML/attribute/URL); no raw HTML sinks (`dangerouslySetInnerHTML` equivalents) without sanitization and a justification comment.
- **R-8.11.4** Privileged/admin actions write an audit log (actor, action, target, timestamp) that is append-only from the application's perspective. REG: audit log retention period registered (T-P1).
- **R-8.11.5** Backups exist for production data with a registered retention/age-out schedule (T-P3), AND restore is tested at least quarterly with a recorded result — an untested backup is a finding, not a control. Where legal holds or immutable backups exist, the registered schedule states how they interact with deletion obligations.

### 8.12 Privacy & data handling
*(Any project handling personal data; MUST for INT/WEB/REG)*

- **R-8.12.1** PII is classified: a short in-repo data inventory lists what personal data is stored, where, and why. New PII fields update the inventory in the same PR (R-5.2 applies).
- **R-8.12.2** Retention and deletion: each PII class has a registered retention period (T-P2), and a working deletion path exists (user deletion request → verifiable removal, including from search indexes and caches; backups age out per the registered T-P3 schedule).
- **R-8.12.3** Least-privilege data access: services and roles read only the fields they need; broad `SELECT *`-style access to PII tables from non-owning modules is a finding.
- **R-8.12.4** Direct identifiers and sensitive attributes (names, emails, phone numbers, addresses, government IDs, free-text user content) never appear in logs, error reports, analytics events, or URLs (enforced with R-8.9.5 scrubbing). Opaque internal user IDs are permitted per the R-8.9.4 carve-out, under access control.

---

## 9. Efficiency requirements

### 9A. Cross-cutting gates

- **R-9.1** Budgets split into two enforcement classes. **Machine-enforceable budgets** (bundle KB, CWV, coverage ratchet, CI minutes, query/endpoint latency, vuln count, cost, queue lag) MUST be enforced automatically in CI or monitoring — existing only in a document is non-compliant. **Process budgets** (review response T-3, branch age T-16, triage/flaky SLAs T-19, docs cadence T-14, update cadence T-12) are enforced by workflow: tracked and verified at each quarterly sweep (§12) and audit, with automation (bot reminders, stale-PR alerts) SHOULD where the platform offers it.
- **R-9.2** For **positive continuous budgets** (bundle KB, latency, CI minutes, cost, queue lag), alerting fires at 80% of the hard limit. Zero-tolerance and boolean gates (vulnerabilities, ignored alerts, type errors) alert on first occurrence; ratchets alert on any regression.
- **R-9.3** Server is the authority: authorization, prices, validation, payment truth are server-side; the client is UX.
- **R-9.4** Anything event-driven (webhooks, queues, scheduled jobs) is idempotent and reconciled.
- **R-9.5** Performance regressions are bugs: bundle growth, CWV/latency degradation, CI-time growth each get an owner and enter the defect workflow.

### 9B. Call efficiency (network, queues, jobs, cost)

- **R-9.6** **Timeouts & retries:** every outbound network call has an explicit timeout (T-22 default 10 s; no library-default infinities). Retries only on idempotent operations, capped (T-23 default ≤ 3) with exponential backoff + jitter; retry storms (unjittered tight loops) are defects.
- **R-9.7** **Concurrency & rate:** fan-out to any single vendor/host is bounded by an explicit concurrency limit or client-side rate limiter in the adapter (R-8.10). Unbounded `Promise.all`-style fan-out over unbounded input is a defect.
- **R-9.8** **Pagination:** every list read — internal endpoint or external API — is paginated or explicitly bounded; unbounded "fetch all" over growable collections is banned (extends R-8.3.3). Default page size registered (T-24).
- **R-9.9** **Caching:** every read-heavy repeated external call has a declared cache policy in the adapter — TTL/invalidation strategy, or an explicit "no-cache because X" comment. Duplicate identical calls within one request/render are defects (dedupe/memoize).
- **R-9.10** **Queues & jobs:** background queues have a registered lag/age alert threshold (T-P7); jobs are idempotent, have max runtime and memory budgets where the platform constrains them, and dead-letter with alerting rather than silently retrying forever.
- **R-9.11** **Per-endpoint SLOs:** WEB/REG register p95 latency SLOs for interactive endpoints (T-P6) and alert on breach.
- **R-9.12** **Cost budgets:** metered external services (LLM APIs, per-request vendors, storage egress) have a registered monthly budget (T-P4) with alerting at 80% (R-9.2); cost per unit (per request/user/job) is tracked for the top spend drivers and reviewed monthly with a named owner.

---

## 10. CI/CD quality gates

Static-analysis gating is standards-backed (ISO/IEC 5055/CWE). [STD]

**R-10.1** Gates before merge to default branch (fastest first, fail fast), per profile applicability:

1. Format check + lint (zero new warnings)
2. Typecheck (zero errors; suppression ratchet R-8.2.2)
3. Unit + integration tests (new code tested; coverage ratchet R-8.8.2)
4. Static analysis / SAST (ISO 5055/CWE-aligned)
5. Secret scan (R-7.3) + dependency vulnerability scan (R-6.6)
6. Dead-code / unused-dependency scan (R-4.2)
7. Frozen-lockfile install (R-6.1) + license check (R-6.8)
8. Bundle-size budget (R-8.1.5) and a11y checks (R-8.1.7) where a frontend exists

**R-10.2** PR feedback loop ≤ 10 min; fastest signal (lint+types+unit) ≤ 5 min (T-11) — via caching, affected-only checks, E2E sharding, never by trimming coverage. CI-time regressions are defects (R-9.5). [CONV]

**R-10.3** Broken default branch = stop-the-line: fix or revert before new work.

**R-10.4** Build inputs are pinned (toolchains, lockfile-resolved deps, CI actions/images pinned to digests — this establishes repeatability of inputs, not bit-for-bit reproducible output), and **official release artifacts are produced only by CI** (local builds for development are fine; they are never released). SLSA-informed; **no SLSA level is claimed.** Signed provenance generation and consumer verification (SLSA Build L2+) SHOULD be added as maturity grows. [BP, informed by SLSA v1.2]

**R-10.5** OpenSSF Scorecard (or equivalent) SHOULD run periodically; declining scores are findings.

---

## 11. Metrics

- **R-11.1** Track the five DORA metrics at the *project* level to validate the policy: deployment frequency, lead time for changes, change failure rate, failed-deployment recovery time, and **rework rate** (added 2024). Historical elite bands (on-demand deploys, lead time < 1 day, CFR < 5%, recovery < 1 h) are reference points only — current DORA guidance emphasizes improving against your own baseline, not cross-project bands. [BP — descriptive, never per-developer targets]
- **R-11.2** Refactoring prioritized by **hotspots** (churn × complexity), not complexity alone.
- **R-11.3** Coverage %, LOC, and commit counts MUST NOT be used as individual performance measures (Goodhart risk).

---

## 12. Quarterly sweep (stale code, docs, dependencies)

**R-12.1** At least quarterly (all profiles except PROTO), run:

1. Dead-code scan burn-down (R-4.2)
2. Feature-flag audit (R-4.3)
3. Deprecation-marker check (R-4.4)
4. Migration-residue check (R-4.5)
5. Docs contradiction grep (R-5.3) + review-date refresh (R-5.5)
6. Dependency audit: unused (R-6.4), outdated (R-6.5), licenses (R-6.8)
7. Alert-rule audit (R-8.9.3); flaky-quarantine review (R-8.8.4)
8. Full-history secret sweep (R-7.3)
9. Backup-restore test (R-8.11.5) and PII inventory review (R-8.12.1), where applicable
10. Exception register review (R-15.2) and budget-registry review (R-0.4)

---

## 13. Threshold registry (defaults)

Defaults for all configurable numbers. Per R-0.4, each repo accepts these or registers overrides with rationale; the registered value is then enforced at the conformance level of the rule that cites it.

| ID | Threshold | Default | Basis |
|---|---|---|---|
| T-1 | Cyclomatic complexity | ≤ 10 (≤ 15 w/ justification) | NIST SP 500-235 [STD] |
| T-2 | PR size | ≤ 400 LOC (target 200–400) | SmartBear/Cisco [CONV] |
| T-3 | Review first response | ≤ 1 business day | Google [CONV] |
| T-4 | Function / file length | ≤ 60 / ≤ 400 lines | Convention [CONV] |
| T-5 | Coverage | ≥ 80% line coverage of declared core-logic scope, ratcheted; diff-coverage preferred | Google bands [CONV] |
| T-6 | Feature-flag removal | ≤ 30 days after 100% rollout | Vendor guidance [CONV] |
| T-7 | Core Web Vitals p75 | LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 | web.dev [CONV] |
| T-8 | Route JS / CSS budget | ≤ 170 KB (hard 300 KB) / ≤ 50 KB compressed | Lighthouse/Russell [CONV] |
| T-9 | Interactive query latency | p95 < 100 ms; > 1 s = incident (interactive paths only) | Convention [CONV] |
| T-10 | Session ID | ≥ 64 bits entropy; ≥ 128-bit length | OWASP [STD] |
| T-11 | CI feedback | ≤ 10 min PR; ≤ 5 min fast signal | CD lineage [CONV] |
| T-12 | Dependency updates | critical patch ≤ 24 h, high ≤ 72 h; routine interval ≤ 14 days; min release age ≥ 24 h | OpenSSF [BP] |
| T-13 | Crash-free sessions | ≥ 99.5% | Convention [CONV] |
| T-14 | Docs review cadence | critical quarterly | Convention [CONV] |
| T-15 | E2E CI retries | ≤ 2, trace on retry | Playwright guidance [CONV] |
| T-16 | Feature-branch age | ≤ 3 days to merge | Trunk-based/DORA [CONV] |
| T-17 | Unit-suite runtime | < 2 min | Convention [CONV] |
| T-18 | Billing reconciliation | ≥ daily | Convention [CONV] |
| T-19 | Issue triage / flaky fix | ack ≤ 1 business day; fix/delete ≤ 1 sprint | Convention [CONV] |
| T-20 | Prop drilling depth | ≤ 3 levels | Convention [CONV] |
| T-22 | Outbound call timeout | explicit, default ≤ 10 s | Convention [CONV] |
| T-23 | Retry cap | ≤ 3, exponential backoff + jitter, idempotent only | Convention [CONV] |
| T-24 | Page size | default ≤ 100 items | Convention [CONV] |

*(T-21 and T-25 moved to §13B as T-P6 and T-P7 — they were always project-specific values, not universal defaults.)*

### 13B. Project-registered thresholds (no universal default)

These values have no sensible universal default and MUST be registered per-repo where their governing rule applies; "unregistered" is itself the audit failure:

| ID | Threshold | Governing rule |
|---|---|---|
| T-P1 | Audit-log retention period | R-8.11.4 |
| T-P2 | Retention period per PII class | R-8.12.2 |
| T-P3 | Backup retention / age-out schedule | R-8.11.5, R-8.12.2 |
| T-P4 | Monthly cost budget per metered service | R-9.12 |
| T-P5 | Max flaky-quarantine size | R-8.8.4 |
| T-P6 | Per-endpoint p95 SLOs (e.g., 300 ms API, 1 s page) | R-9.11, R-8.9.6 |
| T-P7 | Queue lag/age alert threshold per queue (e.g., > 5 min) | R-9.10 |

---

## 14. Audit procedure

**R-14.1** A full audit: determine profile (R-0.1), load the repo's budget registry (R-0.4, §13B) and exclusions (R-0.5), then walk §§2–13 for applicable rules. Verdicts: **PASS / FAIL / ADVISORY / N/A / EXCEPTION**, issued per rule — or per clause where a rule mixes applicable and inapplicable clauses under the subject-existence rule (§8 preamble). Clause roll-up precedence, considering only verdicts present: **FAIL > EXCEPTION > PASS > ADVISORY > N/A** (any failing applicable clause makes the rule FAIL; otherwise any excepted clause makes it EXCEPTION; and so on — a rule is N/A only when every clause is N/A). ADVISORY is the only verdict available for ○-downgraded rules (R-0.2) and never counts as FAIL. FAIL entries include rule ID, location, evidence per the rule's evidence criterion, and severity:

- **Critical** — security/correctness exposure (unrotated secrets, missing server-side authz, client-originated prices, unverified webhooks, PII in logs). Fix immediately.
- **Major** — structural violations that compound (duplicated knowledge, schema drift, docs contradicting code, dead systems wired in, missing critical-flow tests). Fix within one cycle.
- **Minor** — threshold breaches and hygiene gaps. Burn-down list.

**R-14.2** Output: a report with scorecard by section, all Critical/Major findings with remediation steps, burn-down list with owners, and deltas vs previous audit. Committed to `docs/audits/`. Reports MUST NOT reproduce secret values, credentials, or PII — reference locations, never contents (a leaked-secret finding cites the file/commit, not the secret).

**Scoring model:** per section and overall, compliance % = PASS ÷ (PASS + FAIL), counted over applicable MUST- and SHOULD-level rules only. N/A and ADVISORY verdicts are excluded from the denominator; a valid unexpired EXCEPTION counts as PASS (expired = FAIL per R-15.2). ADVISORY findings and the count of open exceptions are reported alongside, not inside, the score. No composite weighting — a Critical FAIL is never offset by volume of PASSes; the report's headline is "N Critical, N Major, X% compliant", in that order.

**R-14.3** AI-assisted auditing (Claude Code): first map the project's tools onto §8 categories and record the mapping in the report; then evaluate rules mechanically where possible; for [J] rules, quote the code and state reasoning per §0.1.

**R-14.4** AI-assisted building (Claude Code): treat every applicable MUST as a pre-emission constraint; on conflict, restructure to comply or surface the conflict and request a §15 exception. Never silently violate.

---

## 15. Exceptions

- **R-15.1** Any deviation from an applicable MUST/SHOULD requires a written exception: rule ID, reason, scope, owner, **expiry date**. No expiry = invalid.
- **R-15.2** Exceptions live in-repo (`docs/exceptions.md` or ADR), reviewed at each quarterly sweep; expired exceptions convert automatically to audit failures.
- **R-15.3** Exceptions are per-instance, never blanket. "We don't do coverage" is not an exception; "legacy module X exceeds the complexity budget pending the scheduled refactor (owner: Y, expires YYYY-MM-DD)" is. Permanent categorical carve-outs (generated/vendored code) go through R-0.5 exclusions; budget overrides go through R-0.4 registration — exceptions are only for *temporary* deviations.

---

## 16. Policy adoption checklist

To bring a repo under this policy, complete and commit (README or `POLICY.md`). Items apply **where applicable per the R-0.2 matrix and the repo's §8 category mapping**; inapplicable items are marked N/A on the checklist, not skipped silently:

1. **Profile declared** (R-0.1) — and PROTO expiry if applicable (R-0.3)
2. **Budget registry** — defaults accepted or overrides registered with rationale (R-0.4), including all applicable §13B project-registered thresholds
3. **Exclusions declared** in tool configs (R-0.5)
3a. **Naming conventions declared** (or "ecosystem defaults" stated) and lint-wired (R-3.9)
4. **Root files** present (R-2.1) and README complete (R-2.2)
5. **CI gates** wired per R-10.1 for the profile
6. **Tool mapping** — the repo's tools mapped to §8 categories (R-14.3)
7. **Critical-flows list** created (R-8.8.3)
8. **Secrets layers** active: pre-commit + CI/PR scan where applicable + push protection (R-7.3)
9. **Dependency bot** enabled (R-6.5); license list configured (R-6.8)
10. **Observability** — error capture on all runtimes, release tagging, structured logs (§8.9)
11. **PII inventory** if personal data is handled (R-8.12.1)
12. **Owners named** — docs (R-5.5), dashboards (R-8.9.6), budgets/costs (R-9.12)
13. **Exception register** created, may be empty (R-15.2)
14. **First audit** scheduled; report path `docs/audits/` created (R-14.2)

---

## Appendix A — Source table

Accessed 2026-07-17. [STD] sources are pinned to exact versions. "living" = un-versioned, continuously updated guidance — the accessed date is the pin; re-verify at each annual policy review.

| Source | Version | Rules | URL |
|---|---|---|---|
| ISO/IEC 25010 | 2023 | §3 vocabulary | https://www.iso.org/obp/ui/en/#!iso:std:78176:en |
| ISO/IEC 5055 | 2021 | R-10.1(4) | https://www.iso.org/obp/ui#!iso:std:iso-iec:5055:ed-1:v1:en |
| NIST SP 500-235 | 1996 | R-3.6, T-1 | https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-235.pdf |
| ISO/IEC 5230 (OpenChain) | 2020 | R-6.8 | https://www.iso.org/standard/81039.html |
| ISO/IEC 27001 Annex A 8.4/8.25/8.28 | 2022 | §7 | https://www.iso.org/standard/27001 |
| OWASP ASVS | 5.0.0 | §8.4, §8.11, R-8.2.3 | https://owasp.org/www-project-application-security-verification-standard/ |
| OWASP Top 10 | 2025 | §6 (A03), §8.4 (A07) | https://owasp.org/Top10/2025/en/ |
| OWASP Session Mgmt Cheat Sheet | living | R-8.4.5, T-10 | https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html |
| WCAG | 2.2 (W3C Rec) | R-8.1.7 | https://www.w3.org/TR/WCAG22/ |
| SLSA | v1.2 | R-10.4 | https://slsa.dev/spec/v1.2/ |
| OpenSSF Scorecard | living | R-10.5, R-6.7 | https://github.com/ossf/scorecard |
| SemVer | 2.0.0 | R-2.4 | https://semver.org |
| Conventional Commits | 1.0.0 | R-2.7 | https://www.conventionalcommits.org |
| Keep a Changelog | 2.0.0 | R-2.3 | https://keepachangelog.com |
| Google eng-practices | living | R-2.8, R-2.9, T-3 | https://google.github.io/eng-practices/review/reviewer/standard.html |
| Google coverage guidance | 2020 | R-8.8.2, T-5 | https://testing.googleblog.com/2020/08/code-coverage-best-practices.html |
| SmartBear/Cisco review study | 2006 | R-2.8, T-2 | https://smartbear.com/learn/code-review/best-practices-for-peer-code-review/ |
| DORA / Accelerate (five metrics) | living, 2024–25 guidance | R-2.5, R-11.1 | https://dora.dev/guides/dora-metrics/ |
| Atlassian Gitflow ("legacy workflow") | living | R-2.5 | https://www.atlassian.com/git/tutorials/comparing-workflows/gitflow-workflow |
| web.dev Core Web Vitals | living | R-8.1.5, T-7 | https://web.dev/articles/vitals |
| Write the Docs (docs-as-code) | living | §5 | https://www.writethedocs.org/guide/docs-as-code/ |
| Diátaxis | living | R-5.6 | https://diataxis.fr/ |
| Nygard ADRs | 2011 | R-5.4 | https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions |
| OWASP Secrets Mgmt Cheat Sheet | living | §7 | https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html |
| OpenSSF npm/supply-chain guidance | living | R-6.7, T-12 | https://openssf.org/ |
| LaunchDarkly/Unleash flag guidance | living | R-4.3, T-6 | https://launchdarkly.com/docs/guides/flags/technical-debt |
| SWEBOK | v4 (2024) | definitions | https://www.computer.org/education/bodies-of-knowledge/software-engineering |
| Fowler (rule of three), Metz (wrong abstraction), Dodds (AHA, trophy) | — | R-3.3, R-3.4, R-8.8.1 | https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction · https://kentcdodds.com/blog/aha-programming |
