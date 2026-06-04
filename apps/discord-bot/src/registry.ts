/**
 * Command registry. `buildRegistry` is pure + fail-fast (a malformed or duplicate
 * command throws at boot rather than silently disappearing — a skipped command is
 * a silent prod gap). `loadCommands` is the thin filesystem wrapper used at startup.
 */
import type { BotCommand } from "./types.js";

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

/** Startup loader — globs ./commands/*.ts and validates via buildRegistry. */
export async function loadCommands(): Promise<Map<string, BotCommand>> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const url = await import("node:url");
  const dir = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "commands");
  const entries = await fs.readdir(dir);
  const commands: BotCommand[] = [];
  for (const file of entries) {
    if (!file.endsWith(".ts") && !file.endsWith(".js")) continue;
    if (file.endsWith(".test.ts") || file.endsWith(".test.js")) continue;
    const mod = (await import(url.pathToFileURL(path.join(dir, file)).href)) as {
      command?: BotCommand;
    };
    if (!mod.command) throw new Error(`${file} does not export a "command"`);
    commands.push(mod.command);
  }
  return buildRegistry(commands);
}
