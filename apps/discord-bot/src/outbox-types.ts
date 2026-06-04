/**
 * Bot-side mirror of the app's `src/lib/discord/outbox-events.ts` event contract.
 * The two services don't share a package, so this MUST stay in sync — the
 * exhaustive `never` switch in the consumer makes adding an event type a compile
 * error here until it's handled.
 */
export const OUTBOX_EVENT_TYPES = [
  "project.created",
  "project.archived",
  "crew.assignment.changed",
  "discord.link.confirmed",
] as const;

export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[number];

export interface OutboxEvent {
  id: number;
  eventType: OutboxEventType;
  payload: unknown;
  dedupeKey: string;
  createdAt: string;
}

export interface ProjectChannelSpec {
  projectId: string;
  projectNumber: string;
  name: string;
  status: string;
  isTemplate: boolean;
  archived: boolean;
  channelId: string | null;
  members: string[];
  pendingCount: number;
}

export interface CrewChannelsResult {
  discordUserId: string | null;
  projectIds: string[];
}

export interface OutboxPullResult {
  events: OutboxEvent[];
  cursor: number;
}
