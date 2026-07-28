/**
 * The ~25 curated MCP tools (design §12, issue #999) — the jobs agents
 * actually do, one tool per job, named `verb_object` so the object matches
 * the read vocabulary exactly (an agent can correlate a write result with a
 * later `get_*`).
 *
 * This table is the ONE hand-authored editorial layer in the whole MCP
 * surface — deliberately analogous to `src/lib/api/alias.ts`'s curated REST
 * aliases ("a hand-picked ergonomic shortcut… not a generator"). Everything
 * else about a curated tool (its argument schema, required scope, whether it
 * needs an `idempotencyKey`, its possible error codes) is DERIVED from the
 * registry by `scripts/generate-mcp-manifest.mts` — only the tool's identity
 * (which operation it wraps) and its human-facing prose live here, so there
 * is nothing here that could drift from what the operation actually does.
 *
 * Design §7 describes a future `agentOps` annotation colocated in each
 * `convex/*.ts` module (`summary`/`danger`/`mcpTier`) as the long-term home
 * for this kind of metadata — but that annotation format, and the danger
 * classification it depends on, are Phase 5 (#1001) / Phase 4 (#1000) scope,
 * not built yet. This table is the Phase 3-scoped stand-in: when Phase 5
 * lands `agentOps`, migrate `summary`/`prerequisites`/`transition` to read
 * from there instead of duplicating them here (R-3.1) — do not let both
 * exist at once.
 *
 * `operation: null` marks `whoami`, which has no underlying registry
 * operation (`src/lib/api/whoami.ts` is shared with the REST route instead).
 */
export interface CuratedToolDef {
  /** Unprefixed tool name, e.g. "search_assets". The generator applies the
   *  `rvlt_flow.v1.` namespace (design §13). */
  name: string;
  title: string;
  /** The registry operation this tool wraps 1:1, or null for `whoami`. */
  operation: string | null;
  /** One or more sentences: what the tool does and why an agent would call
   *  it. Combined with registry-derived facts (scope, idempotency, errors)
   *  by the generator — do not restate those here. */
  summary: string;
  /** What must already be true / already exist for this call to make sense. */
  prerequisites?: string;
  /** The FROM → TO state transition, for tools that move something through a
   *  lifecycle (dispatch/receive, reserve/release). Omitted for pure reads
   *  and for writes with no meaningful before/after state to name. */
  transition?: string;
}

export const CURATED_TOOL_DEFS: readonly CuratedToolDef[] = [
  {
    name: "whoami",
    title: "Whoami",
    operation: null,
    summary:
      "Confirm this key's identity: org, acting user, live effective permissions, granted scopes, and rate/bulk limits. " +
      "Call this first on a new connection to sanity-check what you can do before attempting anything else.",
  },
  {
    name: "search_assets",
    title: "Search assets",
    operation: "assets.list",
    summary:
      "List every asset in the org — serialized gear and bulk stock — with model, status, and current location. " +
      "There is no server-side search/filter param yet (the underlying query only takes the org id): fetch the list " +
      "and filter over the results for name/model/tag matches, or narrow by cross-referencing `check_availability`.",
  },
  {
    name: "get_asset",
    title: "Get asset",
    operation: "assets.getById",
    summary: "Full detail for one asset by id: model, serial, status, current project (if deployed), maintenance flags.",
  },
  {
    name: "check_availability",
    title: "Check availability",
    operation: "availability.calendarData",
    summary:
      "Every booking across the org within a date range — cross-reference against `search_assets` to see what's " +
      "free for a given window (e.g. \"what's free next Tuesday for a 3-day shoot\").",
    prerequisites: "A date range as epoch milliseconds (`startMs`, `endMs`).",
  },
  {
    name: "list_projects",
    title: "List projects",
    operation: "projects.listPage",
    summary: "Paginated, searchable list of projects (jobs) — filter by status/type or free-text search, sorted.",
  },
  {
    name: "get_project",
    title: "Get project",
    operation: "projectDetail.bundle",
    summary: "Full detail for one project: dates, client, status, and line items — everything the project detail page shows.",
  },
  {
    name: "create_project",
    title: "Create project",
    operation: "projectWrites.createNative",
    summary:
      "Create a new project (job). Only `name` is required; dates, client, and gear can follow with `add_line_items` " +
      "and, for anything not covered by a curated tool, `call_operation`.",
    transition: "(none) → a new project in its default status.",
  },
  {
    name: "add_line_items",
    title: "Add line items",
    operation: "lineItemWrites.addNative",
    summary:
      "Add one gear line item (model/asset + quantity + date range) to a project — the fundamental \"put this gear " +
      "on this job\" action. The in-mutation availability check runs on every add: an overbooking attempt fails with " +
      "`INVENTORY_CONFLICT` (with `conflicts[]` and `suggestions[]`) rather than silently double-booking.",
    prerequisites: "An existing project (`create_project` or `list_projects`/`get_project`).",
  },
  {
    name: "reserve_items",
    title: "Reserve items",
    operation: "warehouseWrites.reassignLineItemUnit",
    summary:
      "Commit a specific serialized unit to a project's line item ahead of dispatch — turns a model+quantity booking " +
      "into a named-serial reservation. Requires the `warehouse:check_out` scope (it's a warehouse-staging action).",
    prerequisites: "A line item already on the project (`add_line_items`) and a specific unit id (`search_assets`/`get_asset`).",
    transition: "line item on a model/quantity basis → line item bound to one serialized unit.",
  },
  {
    name: "release_items",
    title: "Release items",
    operation: "warehouseWrites.undeprepLine",
    summary:
      "Release a line item's staged/reserved units back to the available pool without a full dispatch+return cycle — " +
      "the inverse of `reserve_items` / `stage_pick_list`.",
    transition: "staged/reserved → available.",
  },
  {
    name: "swap_asset",
    title: "Swap asset",
    operation: "projectLineItems.swapLineItemAsset",
    summary:
      "Replace the specific asset committed to a line item with a different one (e.g. a serviceable unit instead of " +
      "one that failed inspection). Use `call_operation` on `reservationConflicts.swapCandidates` first to find valid substitutes.",
  },
  {
    name: "stage_pick_list",
    title: "Stage pick list",
    operation: "warehouseWrites.syncContainersBatch",
    summary:
      "Build/update the warehouse pick list (prep containers) for a project ahead of dispatch — the staging step " +
      "between booking and physically pulling gear.",
    prerequisites: "Line items already on the project.",
  },
  {
    name: "dispatch_gear",
    title: "Dispatch gear",
    operation: "warehouseWrites.checkOutItems",
    summary:
      "Physically check gear out of the warehouse onto a project — gear leaves the building. Requires the " +
      "`warehouse:check_out` scope, granted to no default preset (decision 10) — a deliberate operator grant.",
    transition: "in warehouse → checked out / on-site.",
  },
  {
    name: "receive_gear",
    title: "Receive gear",
    operation: "warehouseWrites.checkInItems",
    summary:
      "Physically check gear back into the warehouse from a project. Requires the `warehouse:check_in` scope.",
    transition: "checked out / on-site → back in warehouse.",
  },
  {
    name: "list_crew",
    title: "List crew",
    operation: "crewMembers.list",
    summary: "Every crew member in the org — name, role, contact, active status.",
  },
  {
    name: "assign_crew",
    title: "Assign crew",
    operation: "crewAssignmentsWrites.createNative",
    summary: "Assign a crew member to a project for a date/time window, optionally with a role, phase, and rate override.",
    prerequisites: "An existing project and crew member (`list_projects`, `list_crew`).",
  },
  {
    name: "get_warehouse_status",
    title: "Get warehouse status",
    operation: "warehouseList.bundle",
    summary: "Org-wide warehouse snapshot: what's currently checked out, due back, and overdue.",
  },
  {
    name: "create_maintenance",
    title: "Create maintenance record",
    operation: "maintenanceWrites.createNative",
    summary: "Log a maintenance record against one or more assets — repair, inspection, or scheduled service.",
    prerequisites:
      "A unique `recordId` minted by the caller (a short human-readable identifier, e.g. \"MAINT-2026-0142\") — " +
      "there's no server-side sequence for this yet.",
  },
  {
    name: "list_overbookings",
    title: "List overbookings",
    operation: "overbookingBoard.bundle",
    summary: "Every overbooking conflict across the org within a date range — the same data the Overbooking Board shows.",
  },
  {
    name: "get_project_financials",
    title: "Get project financials",
    operation: "projectCosts.operationalCosts",
    summary:
      "Cost/margin breakdown for one project. A key created with the `no_financials` flag set " +
      "(/settings/api-keys) force-redacts this regardless of the acting user's role — otherwise " +
      "visibility follows their role like everywhere else.",
  },
];
