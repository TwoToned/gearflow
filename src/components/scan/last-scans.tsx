"use client";

import { useState } from "react";

import { buildScanRowMenu } from "@/lib/row-actions/scan-actions";
import { VERDICT_TONE, clockTime, lastScansHead, verdictWord, type LastScan, type ScanMode } from "@/lib/scan-page";
import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { ScanStrip, type ScanStripEntry } from "@/components/ui/scan-strip";

/**
 * Last scans (spec §9i.4): `Last scans 7 · 6 clean · 1 failed`, the newest `shown`
 * rows then `Show n more · n left`. A row is tag + name, its verdict, the time in
 * mono, `Undo` while the save's window is open (the SAME closure the toast holds),
 * and row ⋯. Tapping a row scans that tag again.
 */
export function LastScans({
  entries,
  mode,
  shown,
  onRescan,
  onOpen,
}: {
  entries: LastScan[];
  mode: ScanMode;
  shown: number;
  onRescan: (tag: string) => void;
  onOpen: (href: string) => void;
}) {
  const [limit, setLimit] = useState(shown);
  if (entries.length === 0) return null;
  const head = lastScansHead(entries, mode);
  const visible = entries.slice(0, limit);
  const left = entries.length - visible.length;
  const strip: ScanStripEntry[] = visible.map((e) => ({
    id: e.id,
    tone: VERDICT_TONE[e.verdict],
    text: e.name ? `${e.tag} · ${e.name}` : e.tag,
    detail: `${verdictWord(mode, e.verdict)} · ${clockTime(e.at)}`,
    undo: e.undo,
    onSelect: () => onRescan(e.tag),
    trailing: <ActionMenu spec={buildScanRowMenu({ assetId: e.assetId, tag: e.tag, onOpen, onRescan })} label={`Actions for ${e.tag}`} />,
  }));
  return (
    <section aria-labelledby="last-scans-head" className="flex flex-col gap-2">
      <h2 id="last-scans-head" className="flex items-baseline gap-2 text-ui-text font-semibold text-ink">
        Last scans <span className="font-mono text-caption text-muted tabular-nums">{head.count}</span>
        {head.summary ? <span className="text-caption font-normal text-muted">{head.summary}</span> : null}
      </h2>
      <ScanStrip entries={strip} />
      {left > 0 ? (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setLimit((n) => n + shown)}>
          Show {Math.min(shown, left)} more · {left} left
        </Button>
      ) : null}
    </section>
  );
}
