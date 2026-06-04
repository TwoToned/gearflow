/**
 * Command-registry contract. FRAMEWORK-FREE on purpose (no discord.js import)
 * so a command's `execute` is unit-testable against a mock CommandContext with
 * zero Discord and zero network.
 *
 * The bot runs in-process now — commands call service functions directly (no
 * HMAC, no HTTP). The runner resolves the actor once per interaction and hands
 * the command a complete `ServiceActor` for linked commands, or `null` for
 * commands that take an unlinked invoker (like `/link`).
 */
import type { ServiceActor } from "@/lib/services/discord-actor";

/** Declarative gate. The runner resolves the live role from the DB per interaction. */
export type PermissionRequirement =
  | { kind: "none" } // anyone in the guild
  | { kind: "linkedUser" } // must have completed /link
  | { kind: "gearflowRole"; anyOf: string[] }; // linked + holds one of these org roles

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
  choices?: { name: string; value: string }[];
}

export interface ReplyOptions {
  content?: string;
  embeds?: Record<string, unknown>[];
  files?: { name: string; data: Buffer | Uint8Array }[];
  ephemeral?: boolean;
}

/**
 * What a command receives. `actor` is non-null when the command's
 * `requiredPermission` is anything other than `{ kind: "none" }` (the runner
 * guarantees it via the gate).
 */
export interface CommandContext {
  /** Discord interaction id — the natural idempotency key for mutating calls. */
  interactionId: string;
  /** Raw string option values, by option name. */
  options: Record<string, string | undefined>;
  /** The org this bot process serves (single-org per process). */
  organizationId: string;
  /** Invoker's Discord user id (always present, even pre-link). */
  discordUserId: string;
  /** Resolved actor — null only for commands gated `{ kind: "none" }`. */
  actor: ServiceActor | null;
  /** The guild the command came from. */
  guildId: string | null;
  /** The channel the command was invoked in (null in DMs). */
  channelId: string | null;
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
