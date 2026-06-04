/**
 * Outbox consumer: pulls events directly from the DB (via services) and
 * converges each project's Discord channel to the desired state. In-process —
 * no HTTP, no HMAC.
 *
 * Converge-to-desired-state (re-apply the full member set every time) is
 * idempotent and self-healing — the same code path is what `/reconcile` would
 * run. Framework-free except where it talks to the `ChannelGateway`.
 */
import type { ChannelGateway } from "./channel-gateway";
import { formatChannelName } from "./channel-name";
import {
  ackOutboxEvents,
  readOutboxEvents,
  recordDiscordHeartbeat,
} from "@/lib/services/outbox-service";
import {
  getCrewActiveProjects,
  getProjectChannelSpec,
  recordProjectChannelId,
} from "@/lib/services/channel-sync-service";
import type { DiscordOutboxEventDto } from "./outbox-events";

export interface ConsumerDeps {
  organizationId: string;
  gateway: ChannelGateway;
  botUserId?: string;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

// ── Per-project mutex ────────────────────────────────────────────────────────
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

export async function convergeProject(projectId: string, deps: ConsumerDeps): Promise<void> {
  return withProjectLock(projectId, async () => {
    const spec = await getProjectChannelSpec(projectId, deps.organizationId);
    if (spec.isTemplate) return;

    let channelId = spec.channelId;

    if (!channelId && !spec.shouldExist) return;

    if (!channelId && spec.shouldExist) {
      const createdId = await deps.gateway.createChannel({
        name: formatChannelName(spec.projectNumber, spec.name),
        categoryId: spec.targetCategoryId,
      });
      const rec = await recordProjectChannelId(
        projectId,
        deps.organizationId,
        createdId,
      );
      if (rec.channelId && rec.channelId !== createdId) {
        deps.log?.("channel.create.race", { projectId, discarded: createdId, kept: rec.channelId });
        await deps.gateway.deleteChannel(createdId);
        channelId = rec.channelId;
      } else {
        channelId = createdId;
        deps.log?.("channel.created", { projectId, channelId });
        if (spec.postWelcomeOnCreate) {
          try {
            await deps.gateway.postWelcome(channelId, {
              title: `${spec.projectNumber} — ${spec.name}`,
              description: `Status: **${spec.status}**`,
            });
          } catch (err) {
            deps.log?.("channel.welcome_failed", { projectId, channelId, error: String(err) });
          }
        }
      }
    }
    if (!channelId) return;

    if (spec.shouldArchive) {
      await deps.gateway.archiveChannel(channelId, spec.targetCategoryId);
      deps.log?.("channel.archived", { projectId, channelId, categoryId: spec.targetCategoryId });
      return;
    }

    await deps.gateway.moveToCategory(channelId, spec.targetCategoryId);
    await deps.gateway.syncMembers(channelId, spec.members);
    if (spec.pendingCount > 0) {
      deps.log?.("channel.pending_access", { projectId, pendingCount: spec.pendingCount });
    }
  });
}

export async function handleEvent(event: DiscordOutboxEventDto, deps: ConsumerDeps): Promise<void> {
  switch (event.eventType) {
    case "project.created":
    case "project.archived":
    case "project.status.changed":
    case "crew.assignment.changed": {
      const { projectId } = event.payload as { projectId: string };
      await convergeProject(projectId, deps);
      return;
    }
    case "discord.link.confirmed": {
      const { crewMemberId } = event.payload as { crewMemberId: string };
      const { projectIds } = await getCrewActiveProjects(crewMemberId, deps.organizationId);
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
 * One poll cycle: read undelivered events since `cursor` (status-driven on the
 * DB side, so a lost cursor only re-pulls PENDING rows), process them in id
 * order, ack the prefix that succeeded, stop on first failure (the tail retries
 * next cycle). Records the heartbeat the admin page reads.
 */
export async function pollOnce(
  cursor: number,
  deps: ConsumerDeps,
): Promise<{ cursor: number; processed: number; failed: boolean }> {
  await recordDiscordHeartbeat(deps.organizationId, deps.botUserId ?? null);
  const events = await readOutboxEvents(deps.organizationId, cursor, 100);
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
    await ackOutboxEvents(deps.organizationId, ackedIds);
  }
  const newCursor = ackedIds.at(-1) ?? cursor;
  return { cursor: newCursor, processed: ackedIds.length, failed };
}
