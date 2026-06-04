/**
 * Transactional-outbox read/ack/emit helpers.
 *
 * Delivery model (from the /autoplan eng review):
 *  - Correctness comes from the row STATUS, not the bot's cursor. The pull returns
 *    only not-yet-processed rows, so a lost cursor (since=0) re-pulls pending work
 *    WITHOUT replaying already-PROCESSED events.
 *  - `since` is an ordering optimization (skip ids the bot already acked).
 *  - Ack is idempotent; duplicate poll workers marking the same row PROCESSED twice
 *    is harmless. Inbound dedupe (channel create) is guarded bot-side by dedupeKey +
 *    `Project.discordChannelId`.
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  type DiscordOutboxEventDto,
  type DiscordOutboxEventType,
  type DiscordOutboxPayloads,
} from "@/lib/discord/outbox-events";

type Db = Prisma.TransactionClient;

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * Emit an outbox event. MUST be called inside the same `$transaction` (pass `tx`)
 * as the mutation it describes, so the event rolls back with a failed parent txn.
 * `dedupeKey` is unique — a retried emit of the same logical event is a no-op.
 */
export async function emitOutboxEvent<T extends DiscordOutboxEventType>(
  tx: Db,
  input: {
    organizationId: string;
    eventType: T;
    payload: DiscordOutboxPayloads[T];
    dedupeKey: string;
  },
): Promise<void> {
  await tx.discordOutbox.create({
    data: {
      organizationId: input.organizationId,
      eventType: input.eventType,
      payload: input.payload as unknown as Prisma.InputJsonValue,
      dedupeKey: input.dedupeKey,
    },
  });
}

/**
 * Emit only when the org has an ENABLED Discord integration, so orgs that never
 * use Discord don't accumulate orphan PENDING rows nobody polls. The check runs
 * in the caller's `tx`, so emission stays atomic with the mutation. Returns true
 * if an event was written.
 */
export async function emitIfDiscordEnabled<T extends DiscordOutboxEventType>(
  tx: Db,
  input: {
    organizationId: string;
    eventType: T;
    payload: DiscordOutboxPayloads[T];
    dedupeKey: string;
  },
): Promise<boolean> {
  const integration = await tx.discordIntegration.findUnique({
    where: { organizationId: input.organizationId },
    select: { isEnabled: true },
  });
  if (!integration?.isEnabled) return false;
  await emitOutboxEvent(tx, input);
  return true;
}

/**
 * Read undelivered events for an org with id > since, oldest first. Returns
 * PENDING and retry-due FAILED rows; PROCESSED/PROCESSING rows are skipped so a
 * cursor reset never replays completed work.
 */
export async function readOutboxEvents(
  organizationId: string,
  since: number,
  limit: number,
  db: Db = prisma,
  now: Date = new Date(),
): Promise<DiscordOutboxEventDto[]> {
  const take = Math.min(Math.max(1, limit || DEFAULT_LIMIT), MAX_LIMIT);
  const rows = await db.discordOutbox.findMany({
    where: {
      organizationId,
      id: { gt: since },
      OR: [
        { status: "PENDING" },
        { status: "FAILED", nextAttemptAt: { lte: now } },
        { status: "FAILED", nextAttemptAt: null },
      ],
    },
    orderBy: { id: "asc" },
    take,
  });

  return rows.map((row) => ({
    id: row.id,
    eventType: row.eventType as DiscordOutboxEventType,
    payload: row.payload,
    dedupeKey: row.dedupeKey,
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * Mark events PROCESSED after the bot has applied them. Idempotent and org-scoped
 * (a row from another org is ignored). Returns the number of rows transitioned.
 */
export async function ackOutboxEvents(
  organizationId: string,
  ids: number[],
  db: Db = prisma,
  now: Date = new Date(),
): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await db.discordOutbox.updateMany({
    where: {
      organizationId,
      id: { in: ids },
      status: { not: "PROCESSED" },
    },
    data: { status: "PROCESSED", processedAt: now, lockedAt: null },
  });
  return result.count;
}

/** Record the bot's heartbeat on poll. UI derives online/offline from this. */
export async function recordDiscordHeartbeat(
  organizationId: string,
  botUserId: string | null,
  db: Db = prisma,
  now: Date = new Date(),
): Promise<void> {
  await db.discordIntegration.updateMany({
    where: { organizationId },
    data: {
      lastHeartbeatAt: now,
      ...(botUserId ? { botUserId } : {}),
    },
  });
}
