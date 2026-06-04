/**
 * discord.js v14 implementation of ChannelGateway. This is the only place real
 * Discord channel/permission effects happen; the consumer's converge logic stays
 * framework-free and unit-tested against a fake gateway. Not unit-tested here (it
 * needs a live guild) — keep it thin: each method is a direct discord.js call.
 *
 * Required bot permission bits: Manage Channels, Manage Roles, View Channels.
 */
import {
  ChannelType,
  PermissionFlagsBits,
  type CategoryChannel,
  type Guild,
  type OverwriteResolvable,
  type TextChannel,
} from "discord.js";
import type { ChannelGateway } from "./channel-gateway.js";

export class DiscordChannelGateway implements ChannelGateway {
  constructor(
    private readonly guild: Guild,
    private readonly botUserId: string,
  ) {}

  async createChannel(opts: { name: string; categoryId: string | null }): Promise<string> {
    const channel = await this.guild.channels.create({
      name: opts.name,
      type: ChannelType.GuildText,
      parent: (opts.categoryId as CategoryChannel["id"] | null) ?? undefined,
      // Private by default: deny @everyone; the bot keeps access to manage it.
      permissionOverwrites: [
        { id: this.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: this.botUserId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageChannels,
          ],
        },
      ],
    });
    return channel.id;
  }

  async deleteChannel(channelId: string): Promise<void> {
    const channel = await this.guild.channels.fetch(channelId).catch(() => null);
    if (channel) await channel.delete("GearFlow: discarded duplicate channel");
  }

  async syncMembers(channelId: string, memberDiscordIds: string[]): Promise<void> {
    const channel = (await this.guild.channels.fetch(channelId).catch(() => null)) as
      | TextChannel
      | null;
    if (!channel) return;

    // Only include ids that are actually guild members — overwriting a non-member
    // throws. Unlinked/absent crew are simply not in the set (no-op, no failure).
    const present = await Promise.all(
      memberDiscordIds.map(async (id) => ((await this.guild.members.fetch(id).catch(() => null)) ? id : null)),
    );

    const overwrites: OverwriteResolvable[] = [
      { id: this.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: this.botUserId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
        ],
      },
      ...present
        .filter((id): id is string => id !== null)
        .map((id) => ({
          id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
        })),
    ];

    // `.set` replaces ALL overwrites → the channel converges to exactly this set
    // (revokes anyone removed from the project in the same call).
    await channel.permissionOverwrites.set(overwrites, "GearFlow: sync project crew");
  }

  async moveToCategory(channelId: string, categoryId: string | null): Promise<void> {
    const channel = (await this.guild.channels.fetch(channelId).catch(() => null)) as
      | TextChannel
      | null;
    if (!channel) return;
    if ((channel.parentId ?? null) === (categoryId ?? null)) return; // already there
    await channel.setParent(categoryId, { lockPermissions: false, reason: "GearFlow: move category" });
  }

  async archiveChannel(channelId: string, archiveCategoryId: string | null): Promise<void> {
    const channel = (await this.guild.channels.fetch(channelId).catch(() => null)) as
      | TextChannel
      | null;
    if (!channel) return;
    // Move into the archive category (if configured), then lock — deny @everyone
    // and revoke crew; keep the bot so future un-archive can restore access.
    if (archiveCategoryId && channel.parentId !== archiveCategoryId) {
      await channel.setParent(archiveCategoryId, {
        lockPermissions: false,
        reason: "GearFlow: project archived",
      });
    }
    await channel.permissionOverwrites.set(
      [
        { id: this.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: this.botUserId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels] },
      ],
      "GearFlow: project archived",
    );
  }

  async postWelcome(channelId: string, content: { title: string; description?: string }): Promise<void> {
    const channel = (await this.guild.channels.fetch(channelId).catch(() => null)) as
      | TextChannel
      | null;
    if (!channel) return;
    await channel.send({
      embeds: [
        {
          title: content.title,
          description: content.description,
          color: 0x0f766e, // teal — DESIGN.md primary
        },
      ],
    });
  }
}
