"use client";

import { useState } from "react";
import { History } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/formatters";
import { getScanLog } from "@/server/warehouse";

/**
 * Per-unit movement timeline. Reuses the existing `getScanLog` server action
 * (append-only `assetScanLog`, the durable "what went out" ledger) to show a
 * serial's recent check-out / check-in events — most recent first, with the
 * project it was on and who scanned it. Fetched on open so it never weighs down
 * the equipment tab's live subscription. Popover is Radix (the tab is not a
 * modal Dialog, so no pointer-events lock — see CLAUDE.md).
 */

type ScanLog = Awaited<ReturnType<typeof getScanLog>>["logs"][number];

function scanActionLabel(action: string): string {
  switch (action) {
    case "CHECK_OUT":
      return "Deployed";
    case "CHECK_IN":
      return "Returned";
    case "SCAN_VERIFY":
      return "Verified";
    case "TRANSFER":
      return "Transferred";
    default:
      return action;
  }
}

function scanWhen(scannedAt: number | string | null | undefined): string {
  if (scannedAt == null) return "";
  const d = new Date(scannedAt);
  return `${formatDate(d)} · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export function UnitHistoryPopover({ assetId, assetTag }: { assetId: string; assetTag: string }) {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<ScanLog[] | null>(null);
  const [loading, setLoading] = useState(false);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && logs === null && !loading) {
      setLoading(true);
      getScanLog({ assetId, pageSize: 25 })
        .then((res) => setLogs(res.logs))
        .catch(() => setLogs([]))
        .finally(() => setLoading(false));
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-muted hover:text-ink"
          aria-label={`Movement history for ${assetTag}`}
        >
          <History className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-h-80 overflow-y-auto p-0">
        <div className="border-b border-line px-3 py-2">
          <p className="text-caption font-medium text-ink">
            <span className="t-mono">{assetTag}</span> · movement
          </p>
        </div>
        <div className="space-y-0.5 p-1.5">
          {loading && <p className="px-1.5 py-2 text-caption text-muted">Loading…</p>}
          {!loading && (logs?.length ?? 0) === 0 && (
            <p className="px-1.5 py-2 text-caption text-muted">No scan history yet.</p>
          )}
          {logs?.map((l) => (
            <div key={l.id} className="flex items-start justify-between gap-2 rounded-sm px-1.5 py-1">
              <div className="min-w-0">
                <p className="text-caption text-ink">{scanActionLabel(l.action)}</p>
                <p className="truncate text-[11px] text-muted">
                  {l.project?.name ?? "—"}
                  {l.scannedBy?.name ? ` · ${l.scannedBy.name}` : ""}
                </p>
              </div>
              <time className="shrink-0 text-[11px] text-muted">{scanWhen(l.scannedAt)}</time>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
