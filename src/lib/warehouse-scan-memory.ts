/**
 * "Remember for the next n" on the scan sheet (D10): a six-beltpack line asks about its accessories once.
 * The choice is about THIS JOB's gear, so it is scoped to the job (projectId) and the line, and lives in
 * memory only: it dies with the tab, never touches `localStorage`, and is not shared between packers (a
 * shared version needs a schema and is a follow-up). A remembered choice answers a fixed number of scans
 * and then the sheet asks again.
 */
export type RememberedScanChoice =
  | { kind: "with"; accessoryIds: string[] | undefined }
  | { kind: "without" };

type Entry = { choice: RememberedScanChoice; left: number };

const byProject = new Map<string, Map<string, Entry>>();

/** Remember `choice` for the next `count` scans of `lineItemId` on this job (count <= 0 forgets). */
export function rememberScanChoice(projectId: string, lineItemId: string, choice: RememberedScanChoice, count: number): void {
  const lines = byProject.get(projectId) ?? new Map<string, Entry>();
  if (count > 0) lines.set(lineItemId, { choice, left: Math.floor(count) });
  else lines.delete(lineItemId);
  byProject.set(projectId, lines);
}

/** The remembered choice for this scan, spending one of its uses; null when there is none (ask the sheet). */
export function takeRememberedScanChoice(projectId: string, lineItemId: string): RememberedScanChoice | null {
  const lines = byProject.get(projectId);
  const entry = lines?.get(lineItemId);
  if (!lines || !entry) return null;
  if (entry.left <= 1) lines.delete(lineItemId);
  else entry.left -= 1;
  return entry.choice;
}

/** Forget everything remembered for a job (tests, and an explicit reset). */
export function clearScanMemory(projectId?: string): void {
  if (projectId) byProject.delete(projectId);
  else byProject.clear();
}
