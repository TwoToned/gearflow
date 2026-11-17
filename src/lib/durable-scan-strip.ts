import type { ScanStripEntry } from "@/components/ui/scan-strip";
import type { SavedScan } from "@/lib/scan-intake";

const VERB = { deploy: "deploy", return: "receive" } as const;

/**
 * The durable intake's saved scans as scan-strip entries (spec §5.7/§13): the strip is the ONE place a scan's
 * outcome shows, so a pending / review / failed scan is visible here rather than in a separate status block.
 * `Review saved scan` and `Retry saved scan` are the intake's own `retry(id)` (it re-opens review or re-sends
 * the SAME operation id and payload); the strip never builds a second path. Newest first, confirmed scans dropped
 * (the write's own toast already said it landed).
 */
export function intakeToStripEntries(
  entries: readonly SavedScan[],
  retry: (id: string) => void,
  intake: { error?: string | null; unsaved?: { raw: string } | null } = {},
): ScanStripEntry[] {
  const out: ScanStripEntry[] = [];
  if (intake.unsaved) out.push({ id: "unsaved", tone: "error", text: `Not saved: ${intake.unsaved.raw}`, detail: "Keep this page open and copy the barcode before retrying." });
  if (intake.error) out.push({ id: "intake-error", tone: "error", text: intake.error });
  const live = entries.filter((e) => e.state !== "confirmed").sort((a, b) => b.createdAt - a.createdAt);
  for (const e of live) {
    const verb = VERB[e.operation];
    // A pending scan keeps its Retry: after a lost acknowledgement it stays pending with a "waiting" note.
    if (e.state === "pending") out.push({ id: e.id, tone: "neutral", text: `${e.raw}: saved on device, syncing`, detail: e.error, action: { label: "Retry saved scan", onSelect: () => retry(e.id) } });
    else if (e.state === "review") out.push({ id: e.id, tone: "warning", text: `${e.raw}: confirm before it ${verb === "deploy" ? "deploys" : "is received"}`, action: { label: "Review saved scan", onSelect: () => retry(e.id) } });
    else out.push({ id: e.id, tone: "error", text: `${e.raw}: ${e.error ?? "scan failed"}`, action: { label: "Retry saved scan", onSelect: () => retry(e.id) } });
  }
  return out;
}
