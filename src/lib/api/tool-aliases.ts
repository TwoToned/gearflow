/**
 * MCP tool name → registry operation name.
 *
 * The tool names are agent-friendly (`search_assets`); the operations are named
 * after the functions they run (`assets.getAssets`). An agent that fell back from
 * MCP to REST had to rediscover the real name every time, and
 * `describe_operation("search_assets")` failed with NOT_FOUND.
 *
 * With this map, tool names resolve as aliases everywhere: `describe_operation`
 * and `call_operation` accept either, and `list_operations` reports the `mcpTool`
 * for each operation that has one. Two vocabularies, one mental model — without
 * renaming the tools into something an agent reads worse.
 *
 * Deliberately a plain literal with no imports: `dispatch.ts` needs it, and
 * pulling `mcp-tools.ts` (which validates against the whole generated registry at
 * import time) into the dispatcher would create a cycle. `mcp-tools.ts` asserts at
 * import that this map exactly matches the curated tools, so the two cannot drift.
 */
export const TOOL_ALIASES: Record<string, string> = {
  list_projects: "projects.getProjects",
  get_project: "projects.getProject",
  create_project: "projects.createProject",
  update_project_status: "projects.updateProjectStatus",
  search_assets: "assets.getAssets",
  get_asset: "assets.getAsset",
  list_models: "models.getModels",
  list_kits: "kits.listKits",
  get_kit: "kits.getKit",
  check_availability: "line-items.checkAvailability",
  check_availability_batch: "line-items.checkAvailabilityBatch",
  global_search: "search.globalSearch",
  scan_lookup: "scan-lookup.scanLookup",
  list_clients: "clients.getClients",
  create_client: "clients.createClient",
  list_crew: "crew.getCrewMembers",
  list_locations: "locations.getLocations",
  list_suppliers: "suppliers.getSuppliers",
  get_pull_sheet: "warehouse.getProjectPullSheet",
  get_available_assets_for_model: "warehouse.getAvailableAssetsForModel",
  get_project_tasks: "project-tasks.getProjectTasks",
  get_activity_log: "activity-log.getActivityLogs",
};

/** operation name → MCP tool name (inverse of {@link TOOL_ALIASES}). */
export const TOOL_BY_OPERATION: Record<string, string> = Object.fromEntries(
  Object.entries(TOOL_ALIASES).map(([tool, operation]) => [operation, tool]),
);
