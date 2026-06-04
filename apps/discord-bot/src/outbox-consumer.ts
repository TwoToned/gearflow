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
 * Converge one project's channel to the spec returned by the app, honoring the
 * org's create/archive rules:
 *
 *  - !shouldExist + no channel → no-op (skip enquiry-stage projects).
 *  - shouldExist + no channel → create (race-guard via discordChannelId; loser
 *    discards its channel), optionally post the welcome embed, sync members.
 *  - shouldArchive + channel exists → move to the archive category + lock.
 *    Skip member sync (archive locks out everyone except the bot anyway).
 *  - !shouldArchive + channel exists → move to the active category if not already
 *    there (un-archive), sync members.
 *
 * Unlinked crew are simply absent from `members`. Templates are filtered at the
 * spec level (the app sets shouldExist=false for them via the create rule).
 */
export async function convergeProject(projectId: string, deps: ConsumerDeps): Promise<void> {
  return withProjectLock(projectId, async () => {
    const spec = await deps.api.get<ProjectChannelSpec>(`/project/${projectId}/channel-spec`);
    if (spec.isTemplate) return; // belt + braces (the app already filters)

    let channelId = spec.channelId;
    if (!channelId && !spec.shouldExist) {
      // Project is below the org's create threshold (e.g. still in ENQUIRY when
      // create=CONFIRMED). Quietly do nothing; we'll see another event when it
      // moves to a creating status.
      return;
    }

    if (!channelId && spec.shouldExist) {
      const createdId = await deps.gateway.createChannel({
        name: formatChannelName(spec.projectNumber, spec.name),
        categoryId: spec.targetCategoryId,
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
        if (spec.postWelcomeOnCreate) {
          try {
            await deps.gateway.postWelcome(channelId, {
              title: `${spec.projectNumber} — ${spec.name}`,
              description: `Status: **${spec.status}**`,
            });
          } catch (err) {
            // Welcome is nice-to-have; don't fail the converge on a posting hiccup.
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

    // Active path: ensure it's in the active category, then sync members.
    await deps.gateway.moveToCategory(channelId, spec.targetCategoryId);
    await deps.gateway.syncMembers(channelId, spec.members);
    if (spec.pendingCount > 0) {
      deps.log?.("channel.pending_access", { projectId, pendingCount: spec.pendingCount });
    }
  });
}

/** Dispatch a single outbox event. Exhaustive — a new event type fails to compile. */
export async function handleEvent(event: OutboxEvent, deps: ConsumerDeps): Promise<void> {
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
