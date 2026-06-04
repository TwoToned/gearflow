/**
 * The Discord-side effects the outbox consumer performs, behind an interface so
 * the consumer's converge logic is unit-testable with a fake gateway (zero
 * discord.js, zero network). The real impl lives in `runner`/runtime wiring.
 */
export interface ChannelGateway {
  /** Create a private text channel under the category; resolve its channel id. */
  createChannel(opts: { name: string; categoryId: string | null }): Promise<string>;
  /** Delete a channel (used to discard a channel that lost a create race). */
  deleteChannel(channelId: string): Promise<void>;
  /** Set the channel's member view/access overwrites to EXACTLY this id set. */
  syncMembers(channelId: string, memberDiscordIds: string[]): Promise<void>;
  /** Lock + move a channel for a terminal project (archive, never delete). */
  archiveChannel(channelId: string): Promise<void>;
}
