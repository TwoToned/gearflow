import type { FunctionReference } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { OperationMeta, OperationParam } from "./generated/operations";

/**
 * Reads that exist ONLY as Convex queries, with no `src/server/*.ts` action behind
 * them.
 *
 * The app's index pages and real-time surfaces subscribe to Convex directly
 * (`useAuthedQuery(api.kits.list, { orgId })`), so the generated server-action
 * registry — which is everything else the API exposes — cannot see them. Without
 * this bridge, "the API can do anything a user can do" would be false for the
 * collaboration surface, the kits list, the dashboard and warehouse bundles, and
 * per-entity typeahead search.
 *
 * ## Security note (this is the SERVICE-token boundary)
 *
 * `getConvexClient()` attaches the process-global SERVICE token, and Convex's
 * `requireOrgRead`/`requireOrgPermission` short-circuit to *allow* for service
 * callers. So these queries carry NO authorization of their own when called from
 * here. Two rules make that safe, and both are enforced in `runConvexRead`:
 *
 * 1. `orgId` is injected from the authenticated actor and can NEVER be supplied by
 *    the caller — a caller-provided `orgId` is rejected outright.
 * 2. The dispatcher runs `authorizeApiOperation(actor, resource, action)` before
 *    we get here, so scope ∩ RBAC is checked in Node against the acting user.
 *
 * Excluded on purpose: `dashboardLists.home` and `dashboardLists.blocking` require
 * a USER token (they throw for service callers), so they cannot be served this way.
 *
 * See docs/designs/api-mcp-agent-access.md (§"SERVICE-token bypass").
 */

/** A Convex read exposed as an API operation. */
export interface ConvexReadMeta extends OperationMeta {
  kind: "read";
  /** The Convex query to run. */
  ref: FunctionReference<"query">;
  /** Args filled in server-side per call (e.g. `now`), never accepted from callers. */
  autoArgs?: Record<string, () => unknown>;
}

/** `orgId` is always injected from the actor; callers must never send it. */
export const INJECTED_ARGS = new Set(["orgId"]);

const p = (name: string, type: string, optional = false): OperationParam => ({
  name,
  type,
  optional,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated api refs are heterogeneous
type QueryRef = FunctionReference<"query"> | any;

function read(
  name: string,
  ref: QueryRef,
  resource: string,
  action: string,
  params: OperationParam[],
  summary: string,
  autoArgs?: Record<string, () => unknown>,
): ConvexReadMeta {
  const [module, fn] = name.split(".");
  return {
    name,
    module,
    fn,
    kind: "read",
    resource,
    action,
    scope: `${resource}:${action}`,
    params,
    dangerous: false,
    summary,
    ref,
    autoArgs,
  };
}

const now = () => Date.now();
const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};

export const CONVEX_READS: Record<string, ConvexReadMeta> = Object.fromEntries(
  [
    // ── Kits list (the one core entity with no server-action list) ────────────
    read("kits.listKits", api.kits.list, "kit", "read", [], "List all kits in the organization."),

    // ── Per-entity typeahead search ───────────────────────────────────────────
    read("search.kits", api.search.kits, "kit", "read",
      [p("query", "string"), p("limit", "number", true), p("includePrep", "boolean", true)],
      "Typeahead search over kits."),
    read("search.clients", api.search.clients, "client", "read",
      [p("query", "string"), p("limit", "number", true)],
      "Typeahead search over clients."),
    read("search.models", api.search.models, "model", "read",
      [p("query", "string"), p("limit", "number", true)],
      "Typeahead search over equipment models."),
    read("search.suppliers", api.search.suppliers, "supplier", "read",
      [p("query", "string"), p("limit", "number", true)],
      "Typeahead search over suppliers."),

    // ── Collaboration: comments, threads, locks, presence, activity ───────────
    read("collaboration.listThreads", api.collaboration.listThreads, "project", "read",
      [p("entityType", "string"), p("entityId", "string"), p("targetType", "string", true), p("targetId", "string", true)],
      "List comment threads on an entity."),
    read("collaboration.listComments", api.collaboration.listComments, "project", "read",
      [p("threadId", "string")],
      "List the comments in one thread."),
    read("collaboration.listThreadCommentCounts", api.collaboration.listThreadCommentCounts, "project", "read",
      [p("entityType", "string"), p("entityId", "string")],
      "Comment counts per thread on an entity."),
    read("collaboration.listBlockingForProjects", api.collaboration.listBlockingForProjects, "project", "read",
      [p("projectIds", "string[]")],
      "Which of these projects have blocking (unresolved) threads. Max 1000 ids."),
    read("collaboration.getProjectBlockingSummary", api.collaboration.getProjectBlockingSummary, "project", "read",
      [p("projectId", "string")],
      "Summary of blocking threads on a project."),
    read("collaboration.listLocksForEntity", api.collaboration.listLocksForEntity, "project", "read",
      [p("entityType", "string"), p("entityId", "string")],
      "Active edit locks on an entity."),
    read("collaboration.getLock", api.collaboration.getLock, "project", "read",
      [p("entityType", "string"), p("entityId", "string"), p("targetType", "string"), p("targetId", "string")],
      "The active edit lock on one target, if any."),
    read("collaboration.getReviewMarker", api.collaboration.getReviewMarker, "project", "read",
      [p("entityId", "string"), p("targetId", "string")],
      "The review marker on one target."),
    read("collaboration.listPresence", api.collaboration.listPresence, "project", "read",
      [p("entityType", "string"), p("entityId", "string")],
      "Who is currently viewing an entity."),
    read("collaboration.listActivityEvents", api.collaboration.listActivityEvents, "project", "read",
      [p("entityType", "string"), p("entityId", "string"), p("limit", "number", true)],
      "Recent real-time activity events on an entity."),

    // ── Dashboard bundles ─────────────────────────────────────────────────────
    read("dashboard.stats", api.dashboardStats.bundle, "reports", "read", [],
      "Headline dashboard stats for the organization.", { now }),
    read("dashboard.activity", api.dashboardActivity.bundle, "reports", "read", [],
      "Recent activity feed for the dashboard."),
    read("dashboard.subHires", api.dashboardSubHire.bundle, "reports", "read", [],
      "Sub-hire spend and counts for the dashboard.", { now, monthStart }),
    read("dashboard.upcoming", api.dashboardLists.upcoming, "reports", "read", [],
      "Upcoming jobs for the dashboard.", { now }),

    // ── Warehouse bundles ─────────────────────────────────────────────────────
    read("warehouse.listBundle", api.warehouseList.bundle, "warehouse", "read", [],
      "The warehouse index: every project with outstanding gear movements."),
    read("warehouse.detailBundle", api.warehouseDetail.bundle, "warehouse", "read",
      [p("projectId", "string")],
      "Everything the warehouse screen needs for one project."),
    read("warehouse.listCloses", api.warehouseCloses.list, "warehouse", "read", [],
      "Past warehouse close-out records."),

    // ── Project sub-resources ─────────────────────────────────────────────────
    read("project-groups.listByProject", api.projectGroups.listByProject, "project", "read",
      [p("projectId", "string")],
      "Equipment groups on a project."),
    read("line-items.listByProject", api.projectLineItems.listByProject, "project", "read",
      [p("projectId", "string")],
      "Every line item (booked gear) on a project."),

    // ── Composed detail bundles (one round trip instead of many) ──────────────
    read("projects.detailBundle", api.projectDetail.bundle, "project", "read",
      [p("projectId", "string")],
      "Composed project detail: the project plus its related records in one read."),
    read("kits.detailBundle", api.kitDetail.bundle, "kit", "read",
      [p("kitId", "string")],
      "Composed kit detail: the kit plus its contents in one read."),
    read("assets.detailBundle", api.assetDetail.bundle, "asset", "read",
      [p("assetId", "string")],
      "Composed asset detail: the asset plus its history in one read."),
    read("projects.equipmentTabBundle", api.equipmentTab.bundle, "project", "read",
      [p("projectId", "string")],
      "Composed equipment tab for a project."),
    read("line-items.overbookingBundle", api.overbooking.bundle, "project", "read",
      [p("modelIds", "string[]")],
      "Overbooking status for a set of models. Max 1000 ids."),
  ].map((m) => [m.name, m]),
);

export const CONVEX_READ_COUNT = Object.keys(CONVEX_READS).length;
