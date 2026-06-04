/**
 * Command-registry contract — the one source of truth every command depends on.
 * Locked before any command is written (per /autoplan DX review): retrofitting
 * this shape is a breaking change across the whole /commands tree.
 *
 * Deliberately FRAMEWORK-FREE (no discord.js import) so a command's `execute` is
 * unit-testable against a mock CommandContext with zero Discord and zero network.
 * The discord.js adapter lives in runner.ts; the slash-command builder conversion
 * lives in deploy-commands.ts.
 */

/** GearFlow org roles relevant to command gating (subset, checked live per interaction). */
export type GearFlowRole = "owner" | "admin" | "manager" | "staff" | "warehouse" | "viewer";

/** Declarative gate. The runner resolves the live role from GearFlow per interaction. */
export type PermissionRequirement =
  | { kind: "none" } // anyone in the guild
  | { kind: "linkedUser" } // must have completed /link
  | { kind: "gearflowRole"; anyOf: GearFlowRole[] }; // linked + holds one of these org roles

/** Framework-agnostic slash-command descriptor (converted to discord.js in deploy). */
export interface CommandData {
  name: string;
  description: string;
  options?: CommandOption[];
}

export interface CommandOption {
  name: string;
  description: string;
  type: "string" | "integer" | "boolean" | "user";
  required?: boolean;
  /** For string options rendered as a select. */
  choices?: { name: string; value: string }[];
}

/** The person behind the interaction, resolved once by the runner before execute. */
export interface ResolvedActor {
  discordUserId: string;
  /** null when the Discord user has not completed /link in this org. */
  link: { organizationId: string; crewMemberId: string; role: GearFlowRole | null } | null;
}

/** What a command may reply with. Adapted to discord.js reply/editReply by the runner. */
export interface ReplyOptions {
  content?: string;
  /** Embeds as plain objects; runner maps to discord.js EmbedBuilder. */
  embeds?: Record<string, unknown>[];
  files?: { name: string; data: Buffer | Uint8Array }[];
  /** Overrides the command's defaultEphemeral for this specific reply. */
  ephemeral?: boolean;
}

/** Injected into every command. The transport (discord.js) is hidden behind it. */
export interface CommandContext {
  /** Raw string option values, by option name. */
  options: Record<string, string | undefined>;
  /** The resolved actor (link may be null). */
  actor: ResolvedActor;
  /** The guild the command came from (maps to a GearFlow org). */
  guildId: string | null;
  /** The channel the command was invoked in (null in DMs). */
  channelId: string | null;
  /** Typed, HMAC-signing client for src/app/api/discord/v1/*. Stubbable in tests. */
  api: GearFlowApiClient;
  /** Send/replace the (by default ephemeral) reply to the interaction. */
  reply(options: ReplyOptions): Promise<void>;
  /** Defer when the work may exceed Discord's 3s ack window. */
  defer(opts?: { ephemeral?: boolean }): Promise<void>;
  log(event: string, fields?: Record<string, unknown>): void;
}

export interface BotCommand {
  data: CommandData;
  requiredPermission: PermissionRequirement;
  /** Runner enforces this unless a reply overrides it. */
  defaultEphemeral: boolean;
  execute(ctx: CommandContext): Promise<void>;
}

/** Minimal client surface a command uses; the real impl signs + parses envelopes. */
export interface GearFlowApiClient {
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body: unknown, opts?: { idempotencyKey?: string }): Promise<T>;
}
