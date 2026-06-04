/**
 * Command registry. `buildRegistry` is pure + fail-fast (a malformed or duplicate
 * command throws at boot rather than silently disappearing — a skipped command is
 * a silent prod gap).
 */
import type { BotCommand } from "./bot-types";
import { command as assetLookup } from "./commands/asset-lookup";
import { command as fault } from "./commands/fault";
import { command as link } from "./commands/link";

/** The canonical command set, registered in deterministic order. */
export const ALL_COMMANDS: BotCommand[] = [assetLookup, fault, link];

export function buildRegistry(commands: BotCommand[]): Map<string, BotCommand> {
  const map = new Map<string, BotCommand>();
  for (const cmd of commands) {
    if (!cmd?.data?.name) {
      throw new Error("Command is missing data.name");
    }
    if (cmd.data.name !== cmd.data.name.toLowerCase()) {
      throw new Error(`Command name must be lowercase: "${cmd.data.name}"`);
    }
    if (typeof cmd.execute !== "function") {
      throw new Error(`Command "${cmd.data.name}" is missing an execute() function`);
    }
    if (map.has(cmd.data.name)) {
      throw new Error(`Duplicate command name: "${cmd.data.name}"`);
    }
    map.set(cmd.data.name, cmd);
  }
  return map;
}

/** Build the production registry from the canonical command set. */
export function loadCommands(): Map<string, BotCommand> {
  return buildRegistry(ALL_COMMANDS);
}
