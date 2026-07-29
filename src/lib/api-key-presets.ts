/**
 * API key scope presets (Phase 6 — #1002, design §14). The `read_only_agent` /
 * `warehouse_operator` / `finance_reader` / `full_agent` set the Create dialog
 * offers as one-click starting points; an operator can still hand-pick scopes
 * via the explicit picker instead of (or after) applying a preset.
 *
 * Scope strings are hand-listed rather than derived from `rolePermissions`
 * (convex/lib/permissionsCore.ts) on purpose: a preset is a promise about what
 * a key CANNOT do, and that promise must be reviewable at a glance and must
 * not silently widen the day someone adds a new action to a role. The
 * authoritative grant check is still `hasScope`/`isScopeGranted`
 * (convex/lib/scopes.ts) — this file only proposes a starting scope list, it
 * enforces nothing itself.
 *
 * None of these presets grant `delete`, `warehouse:check_out`/`check_in`,
 * `project:unlock_session`, or `project:allow_overbook` — those stay explicit,
 * deliberate opt-ins per §995 decision 7/10 and the archived design's "an
 * agent overbooking is almost always a mistake" finding. They are not offered
 * anywhere in this file, including `full_agent`.
 */

import type { Resource } from "../../convex/lib/permissionsCore";

export interface ApiKeyPreset {
  id: string;
  label: string;
  description: string;
  scopes: string[];
  /** Suggested default for the create dialog's `noFinancials` toggle — the
   *  operator can always override it before minting the key. */
  noFinancialsDefault: boolean;
}

// Resources that expose a genuine `:read` action in the RBAC vocabulary.
// `document` has no read action (only generate/send) and `reports` uses
// `view` instead of `read` — both are handled separately below rather than
// forced into this list, so this stays a literal "every `:read`" set.
const READ_RESOURCES: readonly Resource[] = [
  "asset",
  "bulkAsset",
  "model",
  "kit",
  "project",
  "client",
  "warehouse",
  "testTag",
  "maintenance",
  "location",
  "orgSettings",
  "orgMembers",
  "supplier",
  "subHire",
  "crew",
  "checkItem",
  "invoice",
];

/** "Every `:read` + `self:read`" (design §14) — the literal read_only_agent rule,
 *  reused as the read half of every other preset. */
const READ_ALL_SCOPES: readonly string[] = [
  ...READ_RESOURCES.map((r) => `${r}:read`),
  "reports:view",
  "self:read",
];

/**
 * Non-destructive writes for `full_agent` — "all non-destructive reads +
 * writes. Still no delete, no warehouse movement, no unlock sessions" (design
 * §14). Hand-picked against the OWNER role's action ceiling
 * (permissionsCore.ts `rolePermissions.owner`), dropping:
 *   - every literal `delete` action, plus `invoice:void` (an invoice's
 *     delete-equivalent) and `bulkAsset`/`kit`/`client`/`maintenance`/
 *     `location`/`supplier`/`subHire`/`crew`/`checkItem` deletes
 *   - `warehouse:check_out`/`check_in` ("no warehouse movement" — physical
 *     gear leaving/returning to the building is a deliberate operator grant,
 *     same posture as the `dispatch_gear`/`receive_gear` MCP tools)
 *   - `orgSettings:update` — a full_agent key could otherwise mint further
 *     keys via `assertScopesWithinActor`'s ≤-itself bound, or rewrite org
 *     config; org administration stays a human act
 *   - `orgMembers:invite`/`update_role`/`remove` — HR-sensitive, never a
 *     default grant
 *   - `invoice:xero_manage` — connecting/disconnecting the accounting
 *     integration is a deliberate operator act, not routine agent work
 */
const FULL_AGENT_WRITE_SCOPES: readonly string[] = [
  "asset:create",
  "asset:update",
  "asset:import",
  "asset:export",
  "bulkAsset:create",
  "bulkAsset:update",
  "model:create",
  "model:update",
  "model:import",
  "model:export",
  "kit:create",
  "kit:update",
  "project:create",
  "project:update",
  "project:manage_line_items",
  "project:generate_documents",
  "client:create",
  "client:update",
  "warehouse:scan",
  "warehouse:close",
  "testTag:create",
  "testTag:update",
  "testTag:quick_test",
  "testTag:generate_reports",
  "maintenance:create",
  "maintenance:update",
  "location:create",
  "location:update",
  "document:generate",
  "document:send",
  "supplier:create",
  "supplier:update",
  "subHire:create",
  "subHire:update",
  "crew:create",
  "crew:update",
  "reports:create",
  "reports:export",
  "checkItem:create",
  "checkItem:update",
  "invoice:create",
  "invoice:update",
  "invoice:publish",
  "invoice:issue",
  "invoice:xero_push",
  "self:write",
];

export const API_KEY_PRESETS: readonly ApiKeyPreset[] = [
  {
    id: "read_only_agent",
    label: "Read-only agent",
    description:
      "Every :read scope + self:read. The default for “let an AI look at my data.” No writes of any kind.",
    scopes: [...READ_ALL_SCOPES],
    noFinancialsDefault: true,
  },
  {
    id: "warehouse_operator",
    label: "Warehouse operator",
    description:
      "Reads plus pick-list/prep staging (warehouse:scan). Not check-out or check-in — physical gear movement stays a separate, explicit grant.",
    scopes: [...READ_ALL_SCOPES, "warehouse:scan"],
    noFinancialsDefault: true,
  },
  {
    id: "finance_reader",
    label: "Finance reader",
    description:
      "The same reads as read_only_agent, including quotes and invoices — deliberately the one preset that sees margins (no_financials off by default).",
    scopes: [...READ_ALL_SCOPES],
    noFinancialsDefault: false,
  },
  {
    id: "full_agent",
    label: "Full agent",
    description:
      "All non-destructive reads and writes. Still no delete, no warehouse check-out/check-in, no org administration.",
    scopes: [...READ_ALL_SCOPES, ...FULL_AGENT_WRITE_SCOPES],
    noFinancialsDefault: false,
  },
];

export function findApiKeyPreset(id: string): ApiKeyPreset | undefined {
  return API_KEY_PRESETS.find((p) => p.id === id);
}
