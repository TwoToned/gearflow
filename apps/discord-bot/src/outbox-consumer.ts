/**
 * Outbox consumer: pulls events from GearFlow and converges each project's Discord
 * channel to the desired state. Converge-to-desired-state (re-apply the full member
 * set every time) is idempotent and self-healing — the same code path is what
 * /reconcile would run.
 *
 * Framework-free: the consumer takes a `GearFlowApiClient` + a `ChannelGateway`, so
 * the whole flow is unit-testable with fakes (zero discord.js, zero network).
 */
import type { GearFlowApiClient } from "./types.js";
import type { ChannelGateway } from "./channel-gateway.js";
import { formatChannelName } from "./channel-name.js";
import type {
  CrewChannelsResult,
  OutboxEvent,
  OutboxPullResult,
  ProjectChannelSpec,
} from "./outbox-types.js";

export interface ConsumerDeps {
  api: GearFlowApiClient;
  gateway: ChannelGateway;
  /** Category new project channels are created under (from DiscordIntegration). */
  categoryId: string | null;
  botUserId?: string;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

// ── Per-project mutex ────────────────────────────────────────────────────────
// Serializes converges of the SAME project (prevents a double-create when two
// events for one project are in flight); different projects still run freely.
const projectLocks = new Map<string, Promise<unknown>>();

function withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = projectLocks.get(projectId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  projectLocks.set(
    projectId,
    next.catch(() => undefined).finally(() => {
      if (projectLocks.get(projectId) === next) projectLocks.delete(projectId);
    }),
  );
  return next;
}

/**
 * Converge one project's channel to the desired spec: create (with the cross-
 * instance race guard), archive terminal projects, then re-apply the exact member
 * overwrite set. Unlinked crew are simply absent from `members` (no-op, no failure).
 */
export async function convergeProject(projectId: string, deps: ConsumerDeps): Promise<void> {
  return withProjectLock(projectId, async () => {
    const spec = await deps.api.get<ProjectChannelSpec>(`/project/${projectId}/channel-spec`);
    if (spec.isTemplate) return; // templates never get a channel

    let channelId = spec.channelId;

    if (spec.archived) {
      if (channelId) await deps.gateway.archiveChannel(channelId);
      return;
    }

    if (!channelId) {
      const createdId = await deps.gateway.createChannel({
        name: formatChannelName(spec.projectNumber, spec.name),
        categoryId: deps.categoryId,
      });
      const rec = await deps.api.post<{ channelId: string | null; created: boolean }>(
        `/project/${projectId}/channel`,
        { discordChannelId: createdId },
      );
      if (rec.channelId && rec.channelId !== createdId) {
        // Lost the create race against another worker — discard ours, use theirs.
        deps.log?.("channel.create.race", { projectId, discarded: createdId, kept: rec.channelId });
        await deps.gateway.deleteChannel(createdId);
        channelId = rec.channelId;
      } else {
        channelId = createdId;
        deps.log?.("channel.created", { projectId, channelId });
      }
    }

    if (channelId) {
      await deps.gateway.syncMembers(channelId, spec.members);
      if (spec.pendingCount > 0) {
        deps.log?.("channel.pending_access", { projectId, pendingCount: spec.pendingCount });
      }
    }
  });
}

/** Dispatch a single outbox event. Exhaustive — a new event type fails to compile. */
export async function handleEvent(event: OutboxEvent, deps: ConsumerDeps): Promise<void> {
  switch (event.eventType) {
    case "project.created":
    case "project.archived":
    case "crew.assignment.changed": {
      const { projectId } = event.payload as { projectId: string };
      await convergeProject(projectId, deps);
      return;
    }
    case "discord.link.confirmed": {
      const { crewMemberId } = event.payload as { crewMemberId: string };
      const { projectIds } = await deps.api.get<CrewChannelsResult>(`/crew/${crewMemberId}/channels`);
      // Retroactively grant access to every active assignment the crew now has.
      for (const projectId of projectIds) await convergeProject(projectId, deps);
      return;
    }
    default: {
      const _exhaustive: never = event.eventType;
      throw new Error(`Unhandled outbox event type: ${String(_exhaustive)}`);
    }
  }
}

/**
 * One poll cycle: pull events since `cursor`, process them in id order, ack the
 * successfully-processed prefix, and return the new cursor. On the first failure
 * we STOP (preserve ordering / per-project causality) — the unacked tail stays
 * PENDING and is retried next cycle. The returned cursor only advances past acked
 * events, so a crash before ack safely re-pulls (at-least-once + idempotent).
 */
export async function pollOnce(
  cursor: number,
  deps: ConsumerDeps,
): Promise<{ cursor: number; processed: number; failed: boolean }> {
  const botUserId = deps.botUserId ? `&botUserId=${encodeURIComponent(deps.botUserId)}` : "";
  const { events } = await deps.api.get<OutboxPullResult>(`/outbox?since=${cursor}${botUserId}`);
  if (events.length === 0) return { cursor, processed: 0, failed: false };

  const ackedIds: number[] = [];
  let failed = false;
  for (const event of events) {
    try {
      await handleEvent(event, deps);
      ackedIds.push(event.id);
    } catch (err) {
      deps.log?.("outbox.event_failed", { id: event.id, eventType: event.eventType, error: String(err) });
      failed = true;
      break;
    }
  }

  if (ackedIds.length > 0) {
    await deps.api.post("/outbox/ack", { ids: ackedIds });
  }
  const newCursor = ackedIds.at(-1) ?? cursor;
  return { cursor: newCursor, processed: ackedIds.length, failed };
}
