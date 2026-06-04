/**
 * Build a Discord channel name from a project: `PROJECTCODE-projectname`, e.g.
 * `TTP001-pippin`. Discord lowercases and strips spaces from channel names, so we
 * pre-slugify to keep the result predictable and idempotent (the same project
 * always maps to the same name → safe to diff against existing channels).
 */
const MAX_CHANNEL_NAME = 100; // Discord hard limit

function slug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-") // non-alphanumeric → dash
    .replace(/^-+|-+$/g, "") // trim dashes
    .replace(/-{2,}/g, "-"); // collapse runs
}

export function formatChannelName(projectNumber: string, name: string): string {
  const code = slug(projectNumber);
  const body = slug(name);
  const combined = body ? `${code}-${body}` : code;
  return combined.slice(0, MAX_CHANNEL_NAME).replace(/-+$/g, "") || "project";
}
