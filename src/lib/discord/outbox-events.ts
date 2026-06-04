/**
 * The Discord outbox event contract — shared shape for the transactional outbox.
 *
 * Locked here (plain `src/lib/*`, framework-free) so the EMITTERS (server actions
 * writing `DiscordOutbox` rows inside their `$transaction`) and the CONSUMER (the
 * standalone bot's outbox poller, which mirrors this union and switches on it
 * exhaustively) cannot drift. Adding an event type without handling it becomes a
 * compile error on the bot's `never` default.
 *
 * NOTE: not a "use server" file — never re-export these types from one (CLAUDE.md).
 */

export const DISCORD_OUTBOX_EVENT_TYPES = [
  "project.created",
  "project.archived",
  "crew.assignment.changed",
  "discord.link.confirmed",
] as const;

export type DiscordOutboxEventType = (typeof DISCORD_OUTBOX_EVENT_TYPES)[number];

export interface ProjectCreatedPayload {
  projectId: string;
  projectNumber: string;
  name: string;
  status: string;
}

export interface ProjectArchivedPayload {
  projectId: string;
  status: string;
}

export interface CrewAssignmentChangedPayload {
  projectId: string;
  crewMemberId: string;
  assignmentId: string;
  action: "added" | "removed" | "updated";
}

export interface DiscordLinkConfirmedPayload {
  crewMemberId: string;
  discordUserId: string;
}

/** Maps each event type to its payload shape (for typed emit + consume). */
export interface DiscordOutboxPayloads {
  "project.created": ProjectCreatedPayload;
  "project.archived": ProjectArchivedPayload;
  "crew.assignment.changed": CrewAssignmentChangedPayload;
  "discord.link.confirmed": DiscordLinkConfirmedPayload;
}

/** A single event as returned by the outbox pull. */
export interface DiscordOutboxEventDto {
  id: number;
  eventType: DiscordOutboxEventType;
  payload: unknown;
  dedupeKey: string;
  createdAt: string;
}
