import { prisma } from "../prisma";
import { getProjectById } from "../projects-read";
import { isUserFacingError } from "../errors/user-facing-error";
import type { ActorContext } from "../actor-context";
import { ApiError } from "./errors";
import type {
  ReservationPort,
  ReserveResult,
  ReservePreviewItem,
} from "./reserve-items";
import { addLineItem, checkAvailability } from "@/server/line-items";

/**
 * The production {@link ReservationPort}: turns an authorized reserve request into
 * real inventory holds by REUSING the existing guarded line-item path
 * (`checkAvailability` for preview, `addLineItem` for commit), driven by the API
 * key's ActorContext. This is the design's "reuse existing guarded logic, don't
 * reimplement" principle — availability, RBAC re-check, and audit all come from the
 * same code the web UI runs.
 *
 * Idempotency is enforced here via the `ApiIdempotency` ledger so a retried commit
 * returns the original result instead of double-booking.
 *
 * v1 scope: model-based reservations (reserve N of a model). Asset-specific holds
 * are a fast-follow. The reservation lands as a normal (QUOTED) line — the existing
 * uncommitted-hold state — reversible via the release path.
 *
 * KNOWN LIMITATION (tracked hardening): the availability check and the write are not
 * a single atomic transaction (the availability math lives in TS and can't yet run
 * inside a Convex mutation), so a genuine TOCTOU race exists under concurrent commits
 * for the last unit — the same window the web UI has today. The design's atomic-in-
 * mutation reserve closes it. See docs/designs/api-mcp-agent-access.md.
 */

function actorFromArgs(args: {
  organizationId: string;
  actorUserId: string;
  actorUserName: string;
  apiKeyId?: string;
}): ActorContext {
  return {
    organizationId: args.organizationId,
    userId: args.actorUserId,
    userName: args.actorUserName,
    actorType: "apiKey",
    apiKeyId: args.apiKeyId,
    // Scope was already enforced upstream (authorizeApiOperation); the guarded
    // server actions only use org + user + role from here.
  };
}

/** Map an availability/permission failure from the guarded path to a structured ApiError. */
function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (isUserFacingError(err)) {
    const permissionish = /permission|not allowed|forbidden/i.test(err.message);
    return new ApiError(
      permissionish ? "FORBIDDEN" : "INVENTORY_CONFLICT",
      err.message,
      { retryable: false, details: { code: err.code, hint: err.hint } },
    );
  }
  // Anything else is unexpected — surface as a generic, retryable server error.
  return new ApiError("INVENTORY_CONFLICT", "The reservation could not be completed.", {
    retryable: true,
  });
}

export const convexReservationPort: ReservationPort = {
  async reserve(args) {
    const { organizationId, projectId, items, idempotencyKey, dryRun, apiKeyId } = args;
    const actor = actorFromArgs(args);

    // Defense in depth: confirm the project is in the actor's org before anything
    // (addLineItem also guards, but we never operate on a foreign project).
    const project = await getProjectById(projectId);
    if (!project || project.organizationId !== organizationId) {
      throw new ApiError("NOT_FOUND", `Project '${projectId}' was not found in this organization.`);
    }

    // v1: model-based items only.
    for (const it of items) {
      if (!it.modelId) {
        throw new ApiError(
          "VALIDATION_ERROR",
          "reserve_items v1 supports model-based items (modelId) only; asset-specific holds are coming next.",
          { details: { received: it } },
        );
      }
    }

    // ── PREVIEW (dry run): availability per model, no writes ──────────────────
    if (dryRun) {
      const preview: ReservePreviewItem[] = [];
      for (const it of items) {
        // getProjectById returns raw Convex docs (dates are epoch-ms numbers);
        // checkAvailability takes Date|string|null.
        const start = project.rentalStartDate != null ? new Date(project.rentalStartDate) : null;
        const end = project.rentalEndDate != null ? new Date(project.rentalEndDate) : null;
        const avail = await checkAvailability(it.modelId!, start, end, projectId, actor);
        preview.push({
          modelId: it.modelId!,
          requested: it.quantity,
          available: avail.available,
          sufficient: avail.available >= it.quantity,
          conflicts: avail.conflicts ?? [],
        });
      }
      const short = preview.filter((p) => !p.sufficient);
      return {
        reservationId: null,
        committed: false,
        replayed: false,
        lineItemIds: [],
        summary: short.length
          ? `Cannot fully reserve: ${short.length} of ${preview.length} item(s) short on stock.`
          : `Ready to reserve ${preview.length} item(s) on ${project.name ?? projectId}.`,
        preview,
      };
    }

    // ── COMMIT ────────────────────────────────────────────────────────────────
    if (!apiKeyId) {
      // Commits only ever come from an authenticated API key.
      throw new ApiError("FORBIDDEN", "A committing reserve requires an API key.");
    }

    // Idempotency replay: a prior identical request returns its stored result.
    const prior = await prisma.apiIdempotency.findUnique({
      where: { apiKeyId_key: { apiKeyId, key: idempotencyKey } },
    });
    if (prior) {
      const stored = JSON.parse(prior.result) as ReserveResult;
      return { ...stored, replayed: true };
    }

    const lineItemIds: string[] = [];
    try {
      for (const it of items) {
        const res = (await addLineItem(
          projectId,
          { type: "EQUIPMENT", modelId: it.modelId, quantity: it.quantity },
          /* allowOverbook */ false,
          /* forceSeparate */ false,
          /* includeAccessories */ false,
          actor,
        )) as { success?: boolean; id?: string } | null;

        if (res && res.success === false) {
          throw new ApiError("INVENTORY_CONFLICT", "The reservation was rejected.", {
            retryable: false,
          });
        }
        if (res?.id) lineItemIds.push(res.id);
      }
    } catch (err) {
      throw toApiError(err);
    }

    const result: ReserveResult = {
      reservationId: lineItemIds[0] ?? null,
      committed: true,
      replayed: false,
      lineItemIds,
      summary: `Reserved ${items.length} item(s) on ${project.name ?? projectId}.`,
    };

    // Record for idempotency. On a concurrent double-commit, the unique (apiKeyId,
    // key) index makes the loser fail; treat that as a replay of the winner.
    try {
      await prisma.apiIdempotency.create({
        data: {
          organizationId,
          apiKeyId,
          key: idempotencyKey,
          verb: "reserve_items",
          result: JSON.stringify(result),
        },
      });
    } catch {
      const winner = await prisma.apiIdempotency.findUnique({
        where: { apiKeyId_key: { apiKeyId, key: idempotencyKey } },
      });
      if (winner) return { ...(JSON.parse(winner.result) as ReserveResult), replayed: true };
    }

    return result;
  },
};
