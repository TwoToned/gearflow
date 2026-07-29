/**
 * Turn one MCP operation's raw result into a plain-English sentence for
 * Mira's minimal chat panel (Phase 8, #1004). One case per operation
 * `routeMiraQuestion` (intent-router.ts) can return — keep the two files in
 * sync when adding a route.
 */

interface ProjectBundle {
  project: { name: string; projectNumber: string; status?: string } | null;
}

export function formatMiraAnswer(operation: string, data: unknown): string {
  if (operation === "projectDetail.bundle") {
    const bundle = data as ProjectBundle | null;
    if (!bundle?.project) return "I couldn't find that project in this org.";
    const { name, projectNumber, status } = bundle.project;
    return status ? `${name} (${projectNumber}) is currently ${status}.` : `${name} (${projectNumber}).`;
  }
  if (operation === "assets.list") {
    const list = Array.isArray(data) ? data : [];
    return `Your org has ${list.length} asset${list.length === 1 ? "" : "s"} on file.`;
  }
  return "Here's what I found.";
}
