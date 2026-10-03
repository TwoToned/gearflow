# Tools — reaching RVLT Flow

How to actually talk to the system. Read this before your first write of a
session.

## The surface

Everything agent-reachable goes through one dispatcher. Whether you arrive via
the MCP server, the REST API or a curated tool, the same gates apply: the acting
user's role permissions, the key's scopes, the pricing lock, the org kill
switch, rate limits, bulk caps and the audit log. There is no back door, and you
should not go looking for one.

**Curated tools are the stable contract.** They are additive-only — a field will
not disappear out from under you. Everything reachable via generic dispatch
tracks the app's internals directly and can change shape between refactors.
Prefer a curated tool when one covers the job.

## The curated tools

Tool names are namespaced `rvlt_flow.v1.*`; in an MCP client they typically
surface as `rvlt_flow_v1_<name>`.

### Orientation

| Tool | Use it for |
|---|---|
| `whoami` | Org, acting user, live permissions, granted scopes, rate and bulk limits. **Call first on a new connection.** |
| `list_operations` | The full agent-reachable surface, beyond the curated tools |
| `describe_operation` | One operation's arguments, required scope, idempotency and error codes |
| `call_operation` | Generic dispatch to any operation by name |

### Reads

| Tool | Returns | Watch out for |
|---|---|---|
| `search_assets` | Every asset — serialised and bulk — with model, status, location | No server-side search param: fetch and filter client-side |
| `get_asset` | One asset in full: model, serial, status, current job, maintenance flags | |
| `check_availability` | Every booking across the org in a date range | Takes epoch **milliseconds** (`startMs`, `endMs`) |
| `list_projects` | Paginated, searchable job list; filter by status/type | |
| `get_project` | One job in full: dates, client, status, line items | The workhorse read |
| `list_crew` | Every crew member: name, role, contact, active | |
| `get_warehouse_status` | Org-wide: what's out, due back, overdue | |
| `list_overbookings` | Every conflict in a date range | Same data as the Overbooking Board |
| `get_project_financials` | Cost and margin for one job | Redacted entirely under a no-financials key |
| `get_project_document` | A short-lived download URL for one of the 5 PDFs | See below |

`get_project_document` takes a `docType` of `packing-list`, `return-sheet`,
`delivery-docket` (each rendered fresh from today's state), or `quote` /
`invoice` (the frozen sent/issued document — never re-rendered; `quote` falls
back to a watermarked draft preview, `invoice` reports not-found). The first
three need `project:read`; the finance two need `invoice:read`. Fetch the
returned `url` to get the bytes; no further auth needed.

### Writes

| Tool | Does | Danger |
|---|---|---|
| `create_project` | New job; only `name` is required | low |
| `add_line_items` | Put gear on a job — the fundamental booking action | low |
| `stage_pick_list` | Build/update the warehouse pick list (prep containers) | low |
| `assign_crew` | Crew member onto a job for a window, optional role/phase/rate | low |
| `create_maintenance` | Log a maintenance record against assets | low |
| `swap_asset` | Replace the unit committed to a line | medium |
| `release_items` | Release staged/reserved units back to the pool | medium |
| `reserve_items` | Commit a specific serialised unit to a line | **high** |
| `dispatch_gear` | Check gear out — it leaves the building | **high** |
| `receive_gear` | Check gear back in | **high** |

`add_line_items` runs the availability check in the same transaction. An
overbooking attempt fails with `INVENTORY_CONFLICT` carrying `conflicts[]` and
`suggestions[]` rather than silently double-booking — read the suggestions, they
are substitutes that are actually free.

`swap_asset`: find valid substitutes first via `call_operation` on
`reservationConflicts.swapCandidates`.

## The confirmation gate

Anything classified `danger: high` requires `confirm: true`.

The intended flow, and the one you should follow:

1. Send the call **without** `confirm`.
2. It fails with `CONFIRMATION_REQUIRED` and a human-legible summary of exactly
   what the call would do.
3. Show that summary to the person.
4. On their go-ahead, re-send the **identical** call with `confirm: true`.

Do not skip straight to `confirm: true` because you are confident. The gate
exists so a human sees the consequence before gear moves, and that human is not
you. Equally, a `medium` or `low` operation that supplies a privileged argument
whose own policy is high-danger escalates for that call — the same flow applies.

## Idempotency

Mutations accept an `idempotencyKey` (8+ characters). A retry with the same key
replays the first result instead of double-writing. Use one for anything you
might retry — a timeout on `dispatch_gear` without an idempotency key is a
genuinely bad moment.

Reusing a key for a *different* call fails with `IDEMPOTENCY_KEY_REUSED`. A
still-running earlier call with the same key gives `IDEMPOTENT_IN_PROGRESS` —
retry shortly with the **same** key, not a new one.

## Limits

- **Bulk cap: 50 items per call** for API keys (humans in the UI get 500).
  Exceeding it gives `BULK_TOO_LARGE` — split and retry.
- **Rate limits** are per-key, separate from the human's own UI budget, so a
  looping agent cannot starve the person it acts as out of their own app.
  `RateLimited` carries a `retryAfter` in milliseconds. Respect it.

## Errors and what to do about them

Errors arrive in-band as `{ error: { code, category, message, recovery, requiredScope } }`.
The `recovery` field names the action — use it.

### Auth

| Code | Meaning | Do |
|---|---|---|
| `KEY_INACTIVE` | Key was revoked | An admin must issue a new one |
| `KEY_EXPIRED` | Key expired | An admin must issue a new one |
| `ORG_KILL_SWITCH` | API access switched off org-wide | Contact an admin — this is deliberate |
| `ORG_ARCHIVED` | Org archived | Contact an admin |

### Permission vs scope — the distinction that matters most

| Code | Meaning | Do |
|---|---|---|
| `MISSING_SCOPE` | The **key** is too narrow | An admin can add the named scope in Settings → API keys |
| `FORBIDDEN` | The **person** you act as lacks the permission | Widening the key will not help. Escalate to someone who has it |
| `FORBIDDEN_UNLOCK_PRICING` | Only an admin/owner/manager or the job's PM can clear a pricing lock | Name who can, and ask |
| `AGENT_READ_NOT_MIGRATED` | This read isn't exposed to keys yet | `list_operations` shows what is |

Never report a `FORBIDDEN` as "I need more access" — it is the acting user who
lacks the right, and that is a different (often deliberate) situation.

### Gates

| Code | Meaning | Do |
|---|---|---|
| `CONFIRMATION_REQUIRED` | High-danger call needs a human | Show the summary, get a yes, resend with `confirm: true` |
| `PRICING_LOCKED` | Money edit on a locked job | Surface it; do not route around it |
| `BLOCKING_COMMENTS` | Unresolved blocking comments on the job | They must be resolved before it goes out |
| `ASSET_IN_KIT` | The asset belongs to a kit | Add the kit instead, or remove the asset from it |
| `WRITES_DISABLED` | Writes temporarily off for that domain | Retry later; tell the person |

### Conflicts and validation

| Code | Meaning | Do |
|---|---|---|
| `INVENTORY_CONFLICT` | Not enough stock for those dates | Read `details.suggestions` — substitutes that are free |
| `VALIDATION_FAILED` | Bad arguments | `details.issues` names the fields |
| `INVALID_NUMBER` | NaN, infinite or out of range | Fix the number |
| `BULK_TOO_LARGE` | Over 50 items | Split the batch |
| `DOCUMENT_NOT_READY` | PDF still generating (or failed) | Retry shortly, or point at the Finance tab |
| `NOT_FOUND` | No such row **in this org** | Check the id |
| `UNKNOWN_OPERATION` | No such operation | `list_operations` |

`NOT_FOUND` is org-scoped: a valid id from another organisation reads as not
found. That is the tenancy boundary working, not a bug.

## Going beyond the curated tools

For anything not covered: `list_operations` to find it, `describe_operation` to
learn its arguments and error codes, then `call_operation`. Roughly 550
operations are agent-reachable — about 285 reads and 265 writes.

Be aware this surface **tracks the app's internals** and can change shape
between releases. Prefer a curated tool when one exists, and when you use
generic dispatch, call `describe_operation` rather than assuming an argument
shape from memory.

A large part of the system is structurally unreachable to agents by design —
raw generated CRUD, mirrors, backfills, export internals. If something is not
in `list_operations`, it is not merely undocumented; it cannot be called. Do not
try to construct a path to it.

## Audit

Every write an agent causes is stamped with the key and actor type and lands in
the activity log, filterable and badged as agent-authored. An operator can
review and bulk-revert a bad agent run. Work as though someone will read the
log, because they can and sometimes will.

## When the tools aren't there

If the RVLT Flow MCP server isn't connected in the session, say so directly
rather than answering from assumption. You can still help with reasoning,
planning and process — domain knowledge in this skill is useful without live
data — but be explicit that you are not looking at real rows. Never present a
plausible-sounding job number, asset tag or dollar figure as if it came from the
system.
