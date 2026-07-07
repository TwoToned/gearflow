import type { ActorContext } from "../actor-context";
import { authorizeApiOperation } from "./authorize";
import { ApiError } from "./errors";

/**
 * `reserve_items` — the first agent capability verb: hold specific gear on a
 * project. This is the protocol-agnostic domain service; the MCP tool and the REST
 * route are thin adapters over it.
 *
 * Safety properties enforced HERE, independent of the write backend:
 *   • scope ∩ RBAC via authorizeApiOperation (key must carry the scope AND the
 *     acting user's role must allow "project:manage_line_items").
 *   • The organization is taken from the AUTHORIZED actor, never from caller input
 *     — an agent cannot reserve into another org by passing a different orgId.
 *   • Idempotency is required for a commit (agents retry); the key flows to the
 *     write port so a retried "reserve 3x" produces ONE reservation, not three.
 *   • Structured, machine-actionable errors so an agent can self-recover.
 *
 * The actual availability-atomic write is behind {@link ReservationPort} — a single
 * Convex mutation that re-checks availability, asserts the org, inserts the
 * reservation, writes in-mutation audit, and records the idempotency key, all
 * atomically. That adapter is wired in separately; this service owns the contract.
 *
 * See docs/designs/api-mcp-agent-access.md.
 */

export interface ReserveItemInput {
  /** Reserve by model (quantity from stock) OR a specific asset (quantity 1). Exactly one. */
  modelId?: string;
  assetId?: string;
  quantity: number;
}

export interface ReserveItemsInput {
  projectId: string;
  items: ReserveItemInput[];
  /**
   * Required to COMMIT (confirm=true). Makes the write idempotent under agent
   * retries. Ignored for a preview (confirm=false / dry run).
   */
  idempotencyKey?: string;
  /** false (default) = preview the effect without writing; true = commit the reservation. */
  confirm?: boolean;
}

/** Per-model availability outcome, returned on a preview so an agent can resolve conflicts. */
export interface ReservePreviewItem {
  modelId: string;
  requested: number;
  available: number;
  sufficient: boolean;
  /** Names/numbers of projects competing for the same stock in the window. */
  conflicts: string[];
}

/** Result of a reserve, whether previewed or committed. */
export interface ReserveResult {
  reservationId: string | null; // null on a pure preview
  committed: boolean;
  /** True when a prior identical request (same idempotency key) was replayed — a success, not an error. */
  replayed: boolean;
  lineItemIds: string[];
  /** Human-readable summary the agent can relay ("Reserve 3x Model-X on Project-42"). */
  summary: string;
  /** Present on a preview (dryRun): per-item availability so the agent can decide before committing. */
  preview?: ReservePreviewItem[];
}

/** The availability-atomic write, implemented by the Convex mutation adapter. */
export interface ReservationPort {
  reserve(args: {
    organizationId: string;
    actorUserId: string;
    actorUserName: string;
    apiKeyId?: string;
    projectId: string;
    items: ReserveItemInput[];
    idempotencyKey: string;
    dryRun: boolean;
  }): Promise<ReserveResult>;
}

function validateInput(input: ReserveItemsInput): void {
  if (!input.projectId) {
    throw new ApiError("VALIDATION_ERROR", "projectId is required.", {
      details: { field: "projectId" },
    });
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new ApiError("VALIDATION_ERROR", "At least one item is required.", {
      details: { field: "items" },
    });
  }
  input.items.forEach((item, i) => {
    const hasModel = !!item.modelId;
    const hasAsset = !!item.assetId;
    if (hasModel === hasAsset) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Each item must set exactly one of modelId or assetId.",
        { details: { field: `items[${i}]`, received: { modelId: item.modelId, assetId: item.assetId } } },
      );
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new ApiError("VALIDATION_ERROR", "quantity must be an integer >= 1.", {
        details: { field: `items[${i}].quantity`, received: item.quantity },
      });
    }
  });
}

export async function reserveItems(
  actor: ActorContext,
  input: ReserveItemsInput,
  port: ReservationPort,
): Promise<ReserveResult> {
  // 1. Authorize: key scope ∩ acting user's live RBAC. Throws MISSING_SCOPE /
  //    permission-denied before any work. `organizationId` is the AUTHORIZED org.
  const { organizationId, userId, userName } = await authorizeApiOperation(
    actor,
    "project",
    "manage_line_items",
  );

  // 2. Validate request shape with actionable errors.
  validateInput(input);

  const commit = input.confirm === true;

  // 3. A commit MUST carry an idempotency key — agents retry, and a reserve is not
  //    naturally idempotent. A preview (dry run) doesn't write, so it doesn't need one.
  if (commit && !input.idempotencyKey) {
    throw new ApiError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "confirm=true requires an idempotencyKey so a retried reserve can't double-book.",
    );
  }

  // 4. Hand to the availability-atomic write. Org + acting identity come from the
  //    authorized context, NOT from caller input — the write port asserts the org
  //    server-side too (defense in depth), but we never forward an attacker-chosen org.
  return port.reserve({
    organizationId,
    actorUserId: userId,
    actorUserName: userName,
    apiKeyId: actor.apiKeyId,
    projectId: input.projectId,
    items: input.items,
    idempotencyKey: input.idempotencyKey ?? "",
    dryRun: !commit,
  });
}
