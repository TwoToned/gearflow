import { OPERATIONS } from "./generated/operations";

/**
 * The curated MCP tool set.
 *
 * The app exposes ~508 operations. Publishing all of them as MCP tools would
 * swamp an agent's context and wreck tool-selection accuracy, so the tool list is
 * two-tier:
 *
 * 1. **Named tools** (below) for the flows agents actually reach for. Each maps
 *    onto one registry operation, so there is no second implementation to drift.
 * 2. **`list_operations` / `describe_operation` / `call_operation`** for the long
 *    tail — anything a user can do in the web app is reachable through them.
 *
 * A curated tool is a thin alias: `operation` names the registry entry and
 * `argMap` renames the tool's agent-friendly arguments onto the action's actual
 * parameter names.
 */
export interface CuratedTool {
  name: string;
  operation: string;
  description: string;
  /** toolArgName -> operationParamName. Identity when omitted. */
  argMap?: Record<string, string>;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

const str = (description: string) => ({ type: "string", description });

export const CURATED_TOOLS: CuratedTool[] = [
  // ── Projects ──────────────────────────────────────────────────────────────
  {
    name: "list_projects",
    operation: "projects.getProjects",
    description:
      "List projects (bookings/jobs) in the organization. Read-only. Supports search, status filtering, and paging. Use this to find a projectId before calling get_project or reserve_items. Required scope: project:read.",
    argMap: { filters: "params" },
    inputSchema: {
      type: "object",
      properties: {
        filters: {
          type: "object",
          description:
            "Optional filters: { search?, status?, type?, clientId?, rentalStartDate?, rentalEndDate?, page?, pageSize?, sortBy?, sortOrder? }",
        },
      },
    },
  },
  {
    name: "get_project",
    operation: "projects.getProject",
    description:
      "Get one project in full: dates, client, status, and its line items (the gear booked on it). Read-only. Prerequisite: a projectId from list_projects or global_search. Required scope: project:read.",
    argMap: { projectId: "id" },
    inputSchema: {
      type: "object",
      properties: { projectId: str("The project to fetch.") },
      required: ["projectId"],
    },
  },
  {
    name: "create_project",
    operation: "projects.createProject",
    description:
      "Create a project (booking). Effect: a new project you can then reserve gear onto. Commits immediately — projects are cheap and reversible (archive/delete). Required scope: project:create.",
    argMap: { project: "data" },
    inputSchema: {
      type: "object",
      properties: {
        project: {
          type: "object",
          description:
            "Project fields: { name (required), clientId?, status?, type?, rentalStartDate?, rentalEndDate?, notes? }",
        },
      },
      required: ["project"],
    },
  },
  {
    name: "update_project_status",
    operation: "projects.updateProjectStatus",
    description:
      "Move a project to a new status (its lifecycle stage). Required scope: project:update.",
    argMap: { projectId: "id" },
    inputSchema: {
      type: "object",
      properties: {
        projectId: str("The project to update."),
        status: str("The new status, e.g. QUOTE, CONFIRMED, IN_PROGRESS, COMPLETED."),
      },
      required: ["projectId", "status"],
    },
  },

  // ── Inventory ─────────────────────────────────────────────────────────────
  {
    name: "search_assets",
    operation: "assets.getAssets",
    description:
      "Search and list individual assets (physical units of gear, each with its own tag/serial). Read-only. For gear TYPES rather than units, use list_models. Required scope: asset:read.",
    argMap: { filters: "params" },
    inputSchema: {
      type: "object",
      properties: {
        filters: {
          type: "object",
          description:
            "Optional filters: { search?, status?, modelId?, categoryId?, locationId?, page?, pageSize? }",
        },
      },
    },
  },
  {
    name: "get_asset",
    operation: "assets.getAsset",
    description:
      "Get one asset by id: its model, status, location, tag, and maintenance state. Read-only. Required scope: asset:read.",
    argMap: { assetId: "id" },
    inputSchema: {
      type: "object",
      properties: { assetId: str("The asset to fetch.") },
      required: ["assetId"],
    },
  },
  {
    name: "list_models",
    operation: "models.getModels",
    description:
      "List equipment models (gear types, e.g. 'Shure SM58'). A model has many assets. Reservations are made against a modelId. Read-only. Required scope: model:read.",
    argMap: { filters: "params" },
    inputSchema: {
      type: "object",
      properties: {
        filters: {
          type: "object",
          description: "Optional filters: { search?, categoryId?, page?, pageSize? }",
        },
      },
    },
  },
  {
    name: "get_kit",
    operation: "kits.getKit",
    description:
      "Get one kit (a pre-assembled bundle of gear booked as a unit) with its contents. Read-only. Find a kitId via global_search. Required scope: kit:read.",
    argMap: { kitId: "id" },
    inputSchema: {
      type: "object",
      properties: { kitId: str("The kit to fetch.") },
      required: ["kitId"],
    },
  },
  {
    name: "check_availability",
    operation: "line-items.checkAvailability",
    description:
      "How many units of a model are free over a date range, and what conflicts exist. Read-only — writes nothing. Call this before reserve_items to avoid an INVENTORY_CONFLICT. Required scope: project:read.",
    inputSchema: {
      type: "object",
      properties: {
        modelId: str("The model to check."),
        rentalStartDate: str("ISO date the hire starts. Optional."),
        rentalEndDate: str("ISO date the hire ends. Optional."),
        excludeProjectId: str("Ignore holds belonging to this project. Optional."),
      },
      required: ["modelId"],
    },
  },
  {
    name: "global_search",
    operation: "search.globalSearch",
    description:
      "Search across projects, assets, models, kits, clients and crew at once. Read-only. The fastest way to turn a name a human typed into an id. Required scope: asset:read.",
    inputSchema: {
      type: "object",
      properties: { query: str("Free-text search term.") },
      required: ["query"],
    },
  },
  {
    name: "scan_lookup",
    operation: "scan-lookup.scanLookup",
    description:
      "Resolve a scanned barcode / QR / asset tag to the thing it identifies. Read-only. Required scope: asset:read.",
    inputSchema: {
      type: "object",
      properties: { value: str("The scanned tag, barcode, or serial.") },
      required: ["value"],
    },
  },

  // ── Clients, crew, locations, suppliers ───────────────────────────────────
  {
    name: "list_clients",
    operation: "clients.getClients",
    description: "List customers the org rents to. Read-only. Required scope: client:read.",
    argMap: { filters: "params" },
    inputSchema: {
      type: "object",
      properties: {
        filters: { type: "object", description: "Optional filters: { search?, page?, pageSize? }" },
      },
    },
  },
  {
    name: "create_client",
    operation: "clients.createClient",
    description:
      "Create a customer. Commits immediately (cheap, reversible). Required scope: client:create.",
    argMap: { client: "data" },
    inputSchema: {
      type: "object",
      properties: {
        client: {
          type: "object",
          description: "Client fields: { name (required), email?, phone?, address?, notes? }",
        },
      },
      required: ["client"],
    },
  },
  {
    name: "list_crew",
    operation: "crew.getCrewMembers",
    description: "List crew members and their roles. Read-only. Required scope: crew:read.",
    argMap: { filters: "params" },
    inputSchema: {
      type: "object",
      properties: { filters: { type: "object", description: "Filters: { search?, page?, pageSize? }" } },
      required: ["filters"],
    },
  },
  {
    name: "list_locations",
    operation: "locations.getLocations",
    description:
      "List locations/warehouses gear lives in. Read-only. Required scope: location:read.",
    argMap: { filters: "params" },
    inputSchema: {
      type: "object",
      properties: { filters: { type: "object", description: "Optional filters: { search? }" } },
    },
  },
  {
    name: "list_suppliers",
    operation: "suppliers.getSuppliers",
    description:
      "List suppliers used for sub-hires. Read-only. Required scope: supplier:read.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },

  // ── Warehouse ─────────────────────────────────────────────────────────────
  {
    name: "get_pull_sheet",
    operation: "warehouse.getProjectPullSheet",
    description:
      "The pick list for a project: what must be pulled from the warehouse, and what is already out. Read-only. Required scope: warehouse:read.",
    inputSchema: {
      type: "object",
      properties: { projectId: str("The project to build the pull sheet for.") },
      required: ["projectId"],
    },
  },
  {
    name: "get_available_assets_for_model",
    operation: "warehouse.getAvailableAssetsForModel",
    description:
      "Which specific assets of a model are free to pull right now. Read-only. Use before dispatching to pick unit-level gear. Required scope: warehouse:read.",
    inputSchema: {
      type: "object",
      properties: { modelId: str("The model whose free units you want.") },
      required: ["modelId"],
    },
  },

  // ── Tasks, activity, dashboard ────────────────────────────────────────────
  {
    name: "get_project_tasks",
    operation: "project-tasks.getProjectTasks",
    description: "List the tasks attached to a project. Read-only. Required scope: project:read.",
    inputSchema: {
      type: "object",
      properties: { projectId: str("The project whose tasks you want.") },
      required: ["projectId"],
    },
  },
  {
    name: "get_activity_log",
    operation: "activity-log.getActivityLogs",
    description:
      "Audit trail of who changed what, when. Read-only. Useful for answering 'what happened to this booking'. Required scope: reports:read.",
    inputSchema: {
      type: "object",
      properties: {
        filters: {
          type: "object",
          description: "Optional filters: { entityType?, entityId?, userId?, action?, limit? }",
        },
      },
    },
  },
  {
    name: "get_dashboard",
    operation: "dashboard.getMyHomeData",
    description:
      "The signed-in user's home dashboard: upcoming jobs, tasks, and alerts. Read-only. Required scope: reports:read.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

/** Fail fast at import if a curated tool points at an operation that no longer exists. */
for (const tool of CURATED_TOOLS) {
  const meta = OPERATIONS[tool.operation];
  if (!meta) {
    throw new Error(
      `Curated MCP tool '${tool.name}' targets unknown operation '${tool.operation}'. ` +
        `Re-run 'pnpm api:registry' or fix src/lib/api/mcp-tools.ts.`,
    );
  }
  for (const param of Object.values(tool.argMap ?? {})) {
    if (!meta.params.some((p) => p.name === param)) {
      throw new Error(
        `Curated MCP tool '${tool.name}' maps onto parameter '${param}', which ` +
          `'${tool.operation}' does not accept (has: ${meta.params.map((p) => p.name).join(", ")}).`,
      );
    }
  }
}

/** Rename a curated tool's arguments onto the underlying operation's parameter names. */
export function mapToolArgs(
  tool: CuratedTool,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (!tool.argMap) return args;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    out[tool.argMap[key] ?? key] = value;
  }
  return out;
}

export const CURATED_BY_NAME = new Map(CURATED_TOOLS.map((t) => [t.name, t]));
