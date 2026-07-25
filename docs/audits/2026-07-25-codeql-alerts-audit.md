# CodeQL Alert Audit

**Date:** 2026-07-25 · **Policy:** [`POLICY.md`](../../POLICY.md) · **Profile:** `WEB`
**Method:** `gh api repos/TwoToned/gearflow/code-scanning/alerts --paginate`, filtered to
`tool.name == "CodeQL"`, evaluated at `main` @ `7cce39ce`. Repo scans via
`.github/workflows/codeql.yml` (`javascript-typescript`).

> **Headline: 76 open CodeQL alerts · 0 critical · 6 high · 2 medium · 68 low/note.**
> Of the 6 high-severity findings, 3 are `js/remote-property-injection` and one each of
> `js/insufficient-password-hash` and `js/insecure-randomness` (one high-sev rule,
> `js/remote-property-injection`, accounts for 3 instances). All 6 have real code-level
> substance but **none are directly attacker-reachable without a mitigating factor** — see
> per-finding analysis below. 58 of the 76 open alerts (76%) are `js/unused-local-variable`
> (dead-code hygiene, not security). 55 historical alerts are already `fixed`.

This report is scoped to **CodeQL** alerts only, per the request. The repo also carries **20
open OSSF Scorecard alerts** (workflow/supply-chain hygiene — `TokenPermissionsID`,
`PinnedDependenciesID`, etc.) surfaced by the same `code-scanning/alerts` endpoint under a
different `tool.name`; those are out of scope here and covered in the Appendix pointer only.

## Executive summary

| Rule | Instances | CWE / category | Security severity |
|---|---|---|---|
| `js/unused-local-variable` | 58 | dead code | note (quality) |
| `js/comparison-between-incompatible-types` | 6 | correctness | none (quality) |
| `js/remote-property-injection` | 3 | CWE-915 | **high** |
| `js/useless-assignment-to-local` | 3 | dead code | none (quality) |
| `js/prototype-pollution-utility` | 1 | CWE-1321 | medium |
| `js/insufficient-password-hash` | 1 | CWE-916/CWE-759 | **high** |
| `js/insecure-randomness` | 1 | CWE-338 | **high** |
| `js/indirect-command-line-injection` | 1 | CWE-88 | medium |
| `js/unknown-directive` | 1 | correctness | none (quality) |
| `js/trivial-conditional` | 1 | correctness | none (quality) |
| **Total open** | **76** | | |

---

## 1. High-severity findings

### 1.1 — `js/insufficient-password-hash` — [Alert #2](https://github.com/TwoToned/gearflow/security/code-scanning/2)

- **Location:** [`src/lib/api-key.ts:45`](../../src/lib/api-key.ts#L45)
- **CodeQL message:** "Password from a call to `generateApiKey` is hashed insecurely."
- **What CodeQL flagged:**
  ```ts
  export function hashApiKey(rawToken: string): string {
    return createHash("sha256").update(rawToken).digest("hex");
  }
  ```
  `SHA-256` is a fast, unsalted digest — CodeQL's `js/insufficient-password-hash` query treats
  any hash of a value that flows from a credential-generation function as a "password hash" and
  wants a slow, purpose-built KDF (`bcrypt`/`scrypt`/`argon2`/`PBKDF2`).
- **Context that changes the risk profile:** `rawToken` here is **not** a human-chosen password —
  it's the output of `generateApiKey()`, which is `prefix + randomBytes(24).toString("hex")` (192
  bits of CSPRNG entropy). The threat model for a human password (short, reused, guessable,
  needs brute-force resistance via a slow KDF) doesn't apply to a 192-bit random secret: an
  offline dictionary/brute-force attack against a 192-bit space is infeasible regardless of hash
  speed, and SHA-256 is the industry-standard pattern for API-key lookup hashing (GitHub, Stripe,
  AWS all SHA-256 their key secrets) specifically *because* keys are high-entropy and looked up
  by hash, not verified against a small candidate space the way passwords are.
- **Verdict:** technically-correct CodeQL match on a **rule tuned for passwords, applied to a
  high-entropy secret** — real-world risk is low, but worth either (a) a scoped `docs/exceptions.md`
  entry (POLICY.md §15) explaining the entropy argument, since "we don't do X" isn't a valid
  exception without documentation, or (b) dismissing the alert in GitHub with that justification
  as the dismissal reason so it doesn't keep resurfacing in scans.
- **If remediating anyway:** no behavior change needed for security; if you want the query to stop
  flagging it, an HMAC-SHA256 keyed with a server secret (still fast, but removes the "password
  hash" shape CodeQL pattern-matches on) or a comment-suppressed `// codeql[js/insufficient-password-hash]`
  with rationale would both work. Do **not** switch to bcrypt/argon2 for this path — it adds
  latency to every API-key-authenticated request for no real security gain on an already-192-bit
  secret.

### 1.2 — `js/insecure-randomness` — [Alert #1](https://github.com/TwoToned/gearflow/security/code-scanning/1)

- **Location:** [`src/hooks/use-collaboration.ts:21`](../../src/hooks/use-collaboration.ts#L21)
  (flagged at the `Math.random()` call; alert metadata reports it against the `useMemo` call site
  at line 160 that invokes this function)
- **CodeQL message:** "This uses a cryptographically insecure random number generated at
  `Math.random()` in a security context."
- **What CodeQL flagged:**
  ```ts
  export function getClientSessionId(): string {
    if (typeof sessionStorage === "undefined") return "ssr";
    const key = "__collab_session_id__";
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem(key, id);
    }
    return id;
  }
  ```
  `Math.random()` is a non-cryptographic PRNG; CodeQL flags it whenever the output feeds into a
  value used for identity/lock/session-like comparisons (`js/insecure-randomness`'s taint sinks
  include this pattern generically, independent of actual exploitability).
- **Context that changes the risk profile:** `clientSessionId` disambiguates **two tabs of the
  same already-authenticated user** for the live-editing lock feature
  (`src/hooks/use-collaboration.ts:279`):
  ```ts
  const isOwner = liveLock.ownerUserId === myUserId && liveLock.clientSessionId === clientSessionId;
  ```
  Lock ownership is gated on `ownerUserId === myUserId` (server-verified session identity)
  **first**; `clientSessionId` only breaks the tie between that same user's own tabs. Predicting
  or colliding this value doesn't let a different user hijack a lock — it could at most let one of
  the *legitimate* owner's other tabs falsely believe it holds the lock it already has rights to.
  Real severity is materially lower than CWE-338's default "high."
- **Recommendation:** still an easy, cheap fix — swap for `crypto.randomUUID()` (or
  `crypto.getRandomValues`), which is available in all target browsers and removes any ambiguity:
  ```ts
  id = crypto.randomUUID();
  ```
  Low-risk, low-effort — worth just fixing rather than filing an exception.

### 1.3–1.5 — `js/remote-property-injection` (×3) — Alerts [#13](https://github.com/TwoToned/gearflow/security/code-scanning/13), [#12](https://github.com/TwoToned/gearflow/security/code-scanning/12), [#11](https://github.com/TwoToned/gearflow/security/code-scanning/11)

CWE-915 (Improperly Controlled Modification of Dynamically-Determined Object Attributes). CodeQL
message for all three: *"A property name to write to depends on a user-provided value."* Risk is
prototype pollution / unexpected key overwrite if the property name can be coerced to
`__proto__`, `constructor`, or `prototype`.

**#13 — [`src/server/woocommerce.ts:711`](../../src/server/woocommerce.ts#L711)**
```ts
function parseDate(key: string | null): Date | null {
  if (!key) return null;
  const value = meta.get(key);
  if (!value) return null;
  raw[key] = value;                    // <- flagged sink
  return flexibleDateParse(value, format);
}
// called as:
rentalStart: parseDate(integration.rentalStartKey),
```
`key` traces back to `integration.rentalStartKey`/`rentalEndKey`/`eventStartKey`/`eventEndKey` —
org-level WooCommerce integration settings (field-name mappings configured by an org admin in
Settings → WooCommerce), not raw per-request attacker input. `raw` is a fresh local `{}` object
scoped to one `extractDates()` call and discarded after use — a `__proto__` write here would at
worst reshape that single throwaway object, not `Object.prototype` globally. Exploitability
requires an org **admin** to configure a malicious field-name mapping against their own org,
which is a low-value attack (self-harm within an already-privileged role) unless there's a
separate path where these settings are attacker-influenced from an unprivileged actor — worth a
quick confirm of `WooCommerceIntegrationConfig` provenance in
[`src/server/woocommerce.ts`](../../src/server/woocommerce.ts).

**#12 — [`src/server/sso.ts:224`](../../src/server/sso.ts#L224)**
```ts
export async function updateSSOProviderMeta(
  providerId: string,
  meta: { displayName?: string; icon?: string },
) {
  const { organizationId } = await requirePermission("orgSettings", "update");
  const settings = await readOrgSettingsBlob(organizationId);
  const sso = getSSOFromSettings(settings);
  if (!sso.providerMeta) sso.providerMeta = {};
  sso.providerMeta[providerId] = {                 // <- flagged sink
    displayName: meta.displayName || providerId,
    icon: meta.icon || "key",
  };
  settings.sso = sso;
  await saveOrgSettings(organizationId, settings);
  return { success: true };
}
```
`providerId` is a server-action parameter — client-controlled, gated only by
`requirePermission("orgSettings", "update")` (any org admin). If a caller passes
`providerId = "__proto__"`, `sso.providerMeta.__proto__ = {...}` pollutes the prototype of the
`sso.providerMeta` object for the remainder of that request/serialization before it's persisted
as JSON via `saveOrgSettings`. Since this round-trips through JSON storage
(`readOrgSettingsBlob`/`saveOrgSettings`), the practical pollution is contained to that request's
in-memory object graph rather than a durable global-prototype pollution, but it's still the
**most directly reachable** of the three (authenticated org-admin input, no extra hops).
**Recommend an explicit guard:**
```ts
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
if (DANGEROUS_KEYS.has(providerId)) {
  throw new Error("Invalid provider id");
}
```
or store into a `Map<string, ProviderMeta>` instead of a plain object.

**#11 — [`src/lib/serialize.ts:18`](../../src/lib/serialize.ts#L18)**
```ts
export function serialize<T>(data: T): T {
  ...
  if (typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = serialize(value);              // <- flagged sink
    }
    return result as T;
  }
  return data;
}
```
This is the **highest-blast-radius** of the three by call-site count — per `CLAUDE.md`, "Must
call `serialize()` on all return values" from server actions, so this function runs on nearly
every server-action response in the app. `Object.entries(data)` already skips the *inherited*
`__proto__` accessor (own enumerable properties only), so a literal `{"__proto__": {...}}` in
`data` won't reach this loop as a `"__proto__"` key the usual way JSON.parse would produce — but
if `data` is itself something with an own enumerable `"__proto__"`/`"constructor"` key (e.g.
constructed programmatically, or round-tripped through a library that materializes it as an own
property), `result[key] = ...` would still pollute `result`'s prototype for that recursive call.
Given how central this function is (every server action, per project convention), it's the one
of the three worth hardening regardless of current reachability:
```ts
for (const [key, value] of Object.entries(data)) {
  if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
  result[key] = serialize(value);
}
```

---

## 2. Medium-severity findings

### 2.1 — `js/prototype-pollution-utility` — [Alert #3](https://github.com/TwoToned/gearflow/security/code-scanning/3)

- **Location:** [`src/lib/table-utils.ts:102`](../../src/lib/table-utils.ts#L102)
- **CodeQL message:** "The property chain here is recursively assigned to `current` without
  guarding against prototype pollution."
- **Code:**
  ```ts
  function setNestedWhere(obj: Record<string, unknown>, path: string, value: unknown) {
    const parts = path.split(".");
    if (parts.length === 1) {
      obj[path] = value;
      return;
    }
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]] || typeof current[parts[i]] !== "object") {
        current[parts[i]] = {};
      }
      current = current[parts[i]] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value;      // <- flagged sink
  }
  ```
  This is a generic "utility function that recursively walks/writes a dot-path" pattern — CodeQL
  flags it independent of whether current callers pass attacker-controlled `path` strings (the
  query is about the **utility being unsafe to call**, not a specific reachable exploit).
  **Action:** find every call site of `setNestedWhere` (used for building Prisma `where` clauses
  per the doc comment) and confirm `path` is always a hardcoded/allowlisted column name, not
  derived from request input (e.g. a sort/filter query param). If any caller passes user input,
  add a guard rejecting `__proto__`/`constructor`/`prototype` segments; if all callers are
  internal, add the guard anyway since it's a one-line, zero-cost defense-in-depth fix for a
  reusable utility.

### 2.2 — `js/indirect-command-line-injection` — [Alert #149](https://github.com/TwoToned/gearflow/security/code-scanning/149)

- **Location:** [`scripts/check-migration-drift.mjs:21`](../../scripts/check-migration-drift.mjs#L21)
- **CodeQL message:** "This command depends on an unsanitized command-line argument."
- **Code:**
  ```js
  const base = process.argv[2] || "origin/main";
  function git(cmd) {
    return execSync(`git ${cmd}`, { encoding: "utf8" }).trim();
  }
  // later: git(`merge-base ${base} HEAD`)
  ```
  `base` is interpolated into a shell command via `execSync` with a template string, and it comes
  from `process.argv[2]` — a CLI argument to this Node script. **Context:** this is a CI/dev
  migration-drift gate (`POLICY.md R-8.3.1`), invoked as `node scripts/check-migration-drift.mjs
  [baseRef]` — the argument is supplied by whoever runs the script (CI workflow config or a local
  dev), not by an untrusted remote actor through the running application. It's real shell
  injection *shape*, but the trust boundary is "someone with write access to the workflow file or
  a local shell," which already implies broad repo access.
- **Recommendation:** cheap to fix regardless — switch to `execFileSync("git", ["merge-base", base, "HEAD"])`
  (array-args form, no shell interpolation) to close it structurally rather than relying on the
  "only trusted callers invoke this" assumption.

---

## 3. Low-severity / correctness findings (no security impact)

### 3.1 — `js/comparison-between-incompatible-types` (6 instances)

Comparisons where the static types can never overlap (e.g. comparing an object/Date to `null`
with `===` where the type system says it's already non-nullable, or comparing a `boolean` to
`null`) — usually indicates either dead defensive code or a real logic bug where the wrong
variable is being checked.

| Alert | Location | CodeQL message |
|---|---|---|
| [#15](https://github.com/TwoToned/gearflow/security/code-scanning/15) | [`convex/projectServicesWrites.ts:912`](../../convex/projectServicesWrites.ts#L912) | Variable `date` cannot be of type null, but it is compared to an expression of type null. |
| [#16](https://github.com/TwoToned/gearflow/security/code-scanning/16) | [`src/app/(app)/warehouse/[projectId]/page.tsx:1403`](<../../src/app/(app)/warehouse/[projectId]/page.tsx#L1403>) | This expression is of type boolean, but it is compared to an expression of type null. |
| [#17](https://github.com/TwoToned/gearflow/security/code-scanning/17) | [`src/app/(app)/warehouse/[projectId]/page.tsx:1736`](<../../src/app/(app)/warehouse/[projectId]/page.tsx#L1736>) | This expression is of type boolean, but it is compared to an expression of type null. |
| [#18](https://github.com/TwoToned/gearflow/security/code-scanning/18) | [`src/app/(app)/warehouse/[projectId]/page.tsx:1754`](<../../src/app/(app)/warehouse/[projectId]/page.tsx#L1754>) | This expression is of type boolean, but it is compared to an expression of type null. |
| [#19](https://github.com/TwoToned/gearflow/security/code-scanning/19) | [`src/lib/convex-client.ts:84`](../../src/lib/convex-client.ts#L84) | Variable `value` is of type date, object or regular expression, but it is compared to an expression of type null. |
| [#20](https://github.com/TwoToned/gearflow/security/code-scanning/20) | [`src/lib/serialize.ts:10`](../../src/lib/serialize.ts#L10) | Variable `data` is of type date, object or regular expression, but it is compared to an expression of type null. |

**Recommendation:** review each — the three `warehouse/[projectId]/page.tsx` hits and the
`serialize.ts`/`convex-client.ts` ones look like the common `typeof x === "object" && x !== null`
narrowing pattern where TS has already narrowed `x` to a non-null object type by that point,
making the `!== null` check dead-but-harmless. Worth a pass to confirm none of the three
`warehouse` instances are actually guarding against a real runtime `null`/`undefined` that the
type signature just doesn't declare (Prisma/Convex data shapes are a common source of such
mismatches) — if so, that's a latent bug, not dead code.

### 3.2 — `js/useless-assignment-to-local` (3 instances)

| Alert | Location | CodeQL message |
|---|---|---|
| [#22](https://github.com/TwoToned/gearflow/security/code-scanning/22) | [`src/lib/pdfme/plugins/gearflow-data-table.ts:124`](../../src/lib/pdfme/plugins/gearflow-data-table.ts#L124) | The value assigned to `currentY` here is unused. |
| [#23](https://github.com/TwoToned/gearflow/security/code-scanning/23) | [`src/lib/pdfme/plugins/gearflow-table.ts:309`](../../src/lib/pdfme/plugins/gearflow-table.ts#L309) | The value assigned to `overflow` here is unused. |
| [#24](https://github.com/TwoToned/gearflow/security/code-scanning/24) | [`src/server/woocommerce.ts:341`](../../src/server/woocommerce.ts#L341) | The initial value of `finalProjectNumber` is unused, since it is always overwritten. |

Given `CLAUDE.md`'s note that the PDF pipeline has 5 independent consumers of line-item shape and
history of silent pagination/height bugs, the two `gearflow-*` hits are worth a closer look —
"assigned but immediately overwritten" in pagination/layout code is exactly the shape of bug that
bit this codebase before (tail-drop, height miscalculation).

### 3.3 — `js/trivial-conditional` — [Alert #21](https://github.com/TwoToned/gearflow/security/code-scanning/21)

- **Location:** [`src/app/(app)/projects/[id]/page.tsx:247`](<../../src/app/(app)/projects/[id]/page.tsx#L247>)
- **Message:** "This use of variable `project` always evaluates to true."
- Likely a stale `if (project)` guard after an earlier early-return already narrowed `project` to
  non-null — dead code, low priority.

### 3.4 — `js/unknown-directive` — [Alert #14](https://github.com/TwoToned/gearflow/security/code-scanning/14)

- **Location:** [`convex/emailActions.ts:1`](../../convex/emailActions.ts#L1)
- **Message:** "Unknown directive: `'use node'`."
- `"use node"` is a real, meaningful Convex directive (marks an action as running in the Node.js
  runtime rather than the V8 isolate) — CodeQL's JS/TS analyzer just doesn't recognize
  framework-specific directives beyond `"use strict"`/`"use client"`/`"use server"`. **This is a
  false positive** stemming from CodeQL's directive allowlist, not a code issue. Safe to dismiss
  in GitHub as "false positive" / "won't fix."

### 3.5 — `js/unused-local-variable` (58 instances)

Dead imports/variables/functions — no security relevance, pure hygiene. Full list (58 rows) in
the collapsible section below. Concentrated in `src/lib/pdfme/**` (14), `src/server/**` (7), and
scattered one-offs across app pages/components. Straightforward batch cleanup — running
`pnpm lint --fix` won't remove these (unused-vars is typically a warning, not autofixable for
unused imports without `eslint-plugin-unused-imports`), so this needs either a manual sweep or
enabling that plugin's `--fix` support.

<details>
<summary>All 58 <code>js/unused-local-variable</code> instances</summary>

| Alert | Location | CodeQL message |
|---|---|---|
| [#25](https://github.com/TwoToned/gearflow/security/code-scanning/25) | `convex/crewTimeEntriesWrites.ts:2` | Unused import createId. |
| [#26](https://github.com/TwoToned/gearflow/security/code-scanning/26) | `convex/projectCategoriesWrites.test.ts:21` | Unused variable SERVICE. |
| [#27](https://github.com/TwoToned/gearflow/security/code-scanning/27) | `convex/testTagAssets.ts:4` | Unused import requireOrgReadDoc. |
| [#28](https://github.com/TwoToned/gearflow/security/code-scanning/28) | `convex/testTagAssetsWrites.ts:2` | Unused import createId. |
| [#29](https://github.com/TwoToned/gearflow/security/code-scanning/29) | `scripts/validate-search.ts:78` | Unused variable t0. |
| [#30](https://github.com/TwoToned/gearflow/security/code-scanning/30) | `src/app/(admin)/admin/organizations/[id]/page.tsx:29` | Unused imports BoxIcon, FolderKanban. |
| [#31](https://github.com/TwoToned/gearflow/security/code-scanning/31) | `src/app/(app)/crew/[id]/page.tsx:179` | Unused variable session. |
| [#32](https://github.com/TwoToned/gearflow/security/code-scanning/32) | `src/app/(app)/kits/page.tsx:166` | Unused variable clearFilters. |
| [#33](https://github.com/TwoToned/gearflow/security/code-scanning/33) | `src/app/(app)/settings/woocommerce/page.tsx:9` | Unused import ExternalLink. |
| [#34](https://github.com/TwoToned/gearflow/security/code-scanning/34) | `src/app/(app)/test-and-tag/page.tsx:19` | Unused import getStatusColor. |
| [#35](https://github.com/TwoToned/gearflow/security/code-scanning/35) | `src/app/(app)/test-and-tag/quick-test/components/electrical-step.tsx:42` | Unused variable thresholds. |
| [#36](https://github.com/TwoToned/gearflow/security/code-scanning/36) | `src/app/(app)/test-and-tag/quick-test/page.tsx:4` | Unused import useCallback. |
| [#37](https://github.com/TwoToned/gearflow/security/code-scanning/37) | `src/app/(app)/warehouse/[projectId]/page.tsx:10` | Unused import Container. |
| [#38](https://github.com/TwoToned/gearflow/security/code-scanning/38) | `src/app/auditor/[token]/page.tsx:202` | Unused variable cardBg. |
| [#39](https://github.com/TwoToned/gearflow/security/code-scanning/39) | `src/app/warehouse/display/[token]/page.tsx:4` | Unused import useCallback. |
| [#40](https://github.com/TwoToned/gearflow/security/code-scanning/40) | `src/components/auth/permission-gate.tsx:3` | Unused import useCurrentRole. |
| [#41](https://github.com/TwoToned/gearflow/security/code-scanning/41) | `src/components/layout/command-search.tsx:68` | Unused import PAGE_COMMANDS. |
| [#42](https://github.com/TwoToned/gearflow/security/code-scanning/42) | `src/components/locations/location-table.tsx:147` | Unused variable clearFilters. |
| [#43](https://github.com/TwoToned/gearflow/security/code-scanning/43) | `src/components/projects/category-section.tsx:23` | Unused import cn. |
| [#44](https://github.com/TwoToned/gearflow/security/code-scanning/44) | `src/components/projects/equipment-tab.tsx:68` | Unused import getSubHires. |
| [#45](https://github.com/TwoToned/gearflow/security/code-scanning/45) | `src/components/projects/services-panel.tsx:86` | Unused imports Select, SelectContent, SelectItem, SelectTrigger, SelectValue. |
| [#46](https://github.com/TwoToned/gearflow/security/code-scanning/46) | `src/components/projects/sub-hire-order-dialog.tsx:31` | Unused import Badge. |
| [#47](https://github.com/TwoToned/gearflow/security/code-scanning/47) | `src/components/projects/sub-hire-order-dialog.tsx:48` | Unused imports TableHead, TableHeader. |
| [#48](https://github.com/TwoToned/gearflow/security/code-scanning/48) | `src/components/projects/sub-hire-order-dialog.tsx:428` | Unused variable setShowOnDocs. |
| [#49](https://github.com/TwoToned/gearflow/security/code-scanning/49) | `src/components/settings/permission-matrix.tsx:57` | Unused variable toggleColumn. |
| [#50](https://github.com/TwoToned/gearflow/security/code-scanning/50) | `src/components/settings/permission-matrix.tsx:96` | Unused variable resourceHasAction. |
| [#51](https://github.com/TwoToned/gearflow/security/code-scanning/51) | `src/components/settings/sso-login-behavior.tsx:3` | Unused import Label. |
| [#52](https://github.com/TwoToned/gearflow/security/code-scanning/52) | `src/components/ui/motion.tsx:3` | Unused import useReducedMotion. |
| [#53](https://github.com/TwoToned/gearflow/security/code-scanning/53) | `src/components/warehouse/__tests__/item-check-form.test.tsx:3` | Unused import beforeEach. |
| [#54](https://github.com/TwoToned/gearflow/security/code-scanning/54) | `src/lib/color-utils.ts:16` | Unused function linearToSrgb. |
| [#55](https://github.com/TwoToned/gearflow/security/code-scanning/55) | `src/lib/color-utils.ts:65` | Unused function isLightColor. |
| [#56](https://github.com/TwoToned/gearflow/security/code-scanning/56) | `src/lib/pdfme/block-utils.ts:19` | Unused import generateSectionId. |
| [#57](https://github.com/TwoToned/gearflow/security/code-scanning/57) | `src/lib/pdfme/generate-pdf.ts:19` | Unused import getDefaultSections. |
| [#58](https://github.com/TwoToned/gearflow/security/code-scanning/58) | `src/lib/pdfme/plugins/gearflow-checkbox.ts:6` | Unused import getHelveticaFonts. |
| [#59](https://github.com/TwoToned/gearflow/security/code-scanning/59) | `src/lib/pdfme/plugins/gearflow-checkbox.ts:13` | Unused variable pdfDoc. |
| [#60](https://github.com/TwoToned/gearflow/security/code-scanning/60) | `src/lib/pdfme/plugins/gearflow-call-sheet-info.ts:60` | Unused variable accentColor. |
| [#61](https://github.com/TwoToned/gearflow/security/code-scanning/61) | `src/lib/pdfme/plugins/gearflow-financial-summary.ts:29` | Unused variable labelWidth. |
| [#62](https://github.com/TwoToned/gearflow/security/code-scanning/62) | `src/lib/pdfme/plugins/gearflow-financial-summary.ts:30` | Unused variable valueWidth. |
| [#63](https://github.com/TwoToned/gearflow/security/code-scanning/63) | `src/lib/pdfme/plugins/gearflow-financial-summary.ts:37` | Unused variable font. |
| [#64](https://github.com/TwoToned/gearflow/security/code-scanning/64) | `src/lib/pdfme/plugins/gearflow-financial-summary.ts:38` | Unused variable color. |
| [#65](https://github.com/TwoToned/gearflow/security/code-scanning/65) | `src/lib/pdfme/plugins/gearflow-data-table.ts:8` | Unused import formatDate. |
| [#66](https://github.com/TwoToned/gearflow/security/code-scanning/66) | `src/lib/pdfme/plugins/gearflow-signature-line.ts:6` | Unused import mm2pt. |
| [#67](https://github.com/TwoToned/gearflow/security/code-scanning/67) | `src/lib/pdfme/plugins/gearflow-table.ts:297` | Unused variable groupStartIdx. |
| [#68](https://github.com/TwoToned/gearflow/security/code-scanning/68) | `src/lib/pdfme/plugins/gearflow-table.ts:737` | Unused variable badgeLabel. |
| [#69](https://github.com/TwoToned/gearflow/security/code-scanning/69) | `src/lib/pdfme/section-renderer.test.ts:11` | Unused import TABLE_ROW_HEIGHT_MM. |
| [#70](https://github.com/TwoToned/gearflow/security/code-scanning/70) | `src/lib/pdfme/section-renderer.ts:39` | Unused imports TABLE_ROW_HEIGHT_MM, getDefaultDayHeaderSettings. |
| [#71](https://github.com/TwoToned/gearflow/security/code-scanning/71) | `src/lib/pdfme/section-renderer.test.ts:538` | Unused variable CONTENT_HEIGHT. |
| [#72](https://github.com/TwoToned/gearflow/security/code-scanning/72) | `src/lib/pdfme/section-renderer.ts:972` | Unused variable colWidthMm. |
| [#73](https://github.com/TwoToned/gearflow/security/code-scanning/73) | `src/lib/pdfme/structure-line-items.test.ts:727` | Unused variable categories. |
| [#74](https://github.com/TwoToned/gearflow/security/code-scanning/74) | `src/lib/pdfme/templates/tt-bulk-summary.ts:18` | Unused variable STATUS_LABELS. |
| [#75](https://github.com/TwoToned/gearflow/security/code-scanning/75) | `src/lib/validations/template-section.test.ts:2` | Unused import updateBrandTemplateSchema. |
| [#76](https://github.com/TwoToned/gearflow/security/code-scanning/76) | `src/server/line-items.ts:15` | Unused import getSubHiresByProject. |
| [#77](https://github.com/TwoToned/gearflow/security/code-scanning/77) | `src/server/line-items.ts:16` | Unused import getProjectServicesByOrg. |
| [#78](https://github.com/TwoToned/gearflow/security/code-scanning/78) | `src/server/line-items.ts:18` | Unused import getAssignmentsByProject. |
| [#79](https://github.com/TwoToned/gearflow/security/code-scanning/79) | `src/server/line-items.ts:25` | Unused function orgDefaultTaxRateFor. |
| [#80](https://github.com/TwoToned/gearflow/security/code-scanning/80) | `src/server/csv.ts:382` | Unused variable tagIdx. |
| [#81](https://github.com/TwoToned/gearflow/security/code-scanning/81) | `src/server/sub-hires.ts:290` | Unused variable organizationId. |
| [#82](https://github.com/TwoToned/gearflow/security/code-scanning/82) | `src/server/warehouse.ts:3` | Unused import prisma. |

</details>

---

## 4. Prioritized remediation order

| Priority | Alerts | Action |
|---|---|---|
| 1 | #12 (`sso.ts` property injection) | Add `__proto__`/`constructor`/`prototype` guard on `providerId` — most directly reachable of the high-sev findings (authenticated org-admin input, single hop). |
| 2 | #11 (`serialize.ts` property injection) | Same guard — lower current reachability, but highest blast radius given it runs on nearly every server action response. |
| 3 | #1 (`insecure-randomness`) | Swap `Math.random()` → `crypto.randomUUID()` in `getClientSessionId`. Trivial fix, no downside. |
| 4 | #149 (`indirect-command-line-injection`) | Switch `execSync` template string → `execFileSync` with array args in the migration-drift script. |
| 5 | #3 (`prototype-pollution-utility`) | Audit `setNestedWhere` call sites; add the same key guard regardless. |
| 6 | #13 (`woocommerce.ts` property injection) | Lower priority — admin-configured field names, throwaway local object — but same guard pattern applies if touching this file. |
| 7 | #2 (`insufficient-password-hash`) | Document a `docs/exceptions.md` entry (POLICY.md §15) with the entropy rationale, or dismiss in GitHub with that justification, rather than switching to a slow KDF that adds latency for no real gain. |
| 8 | #14 (`unknown-directive`) | Dismiss as false positive (Convex `"use node"` directive CodeQL doesn't recognize). |
| 9 | #15–#21 (incompatible-types / trivial-conditional, 7 alerts) | Spot-check each — especially the 3 `warehouse/[projectId]/page.tsx` hits — for a real null-handling bug before dismissing as dead code. |
| 10 | #22–#24 (useless-assignment, 3 alerts) | Check the 2 PDF-pipeline hits against `CLAUDE.md`'s PDF cross-cutting-audit note before treating as pure cleanup. |
| 11 | #25–#82 (`unused-local-variable`, 58 alerts) | Batch dead-code sweep; consider `eslint-plugin-unused-imports` with `--fix` to prevent recurrence. |

---

## Appendix: out of scope

- **20 open OSSF Scorecard alerts** (`TokenPermissionsID` ×~9, `PinnedDependenciesID` ×6,
  `BranchProtectionID`, `CodeReviewID`, `VulnerabilitiesID`, `SecurityPolicyID`, `FuzzingID`,
  `CIIBestPracticesID`) — workflow permission/supply-chain hygiene, not CodeQL. Happy to produce a
  matching report for these on request.
- **55 alerts already `state: fixed`** — historical, not re-detailed here; visible at
  `gh api repos/TwoToned/gearflow/code-scanning/alerts -q '.[] | select(.state=="fixed")'`.
