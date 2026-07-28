"use client";

import { Loader2, FileClock } from "lucide-react";

import { useServerQuery } from "@/hooks/use-server-query";
import { getApiKeyRequestLog } from "@/server/api-keys";
import { formatDate } from "@/lib/formatters";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface RequestLogEntry {
  ts: number;
  operation: string;
  kind: "query" | "mutation";
  status: "success" | "error";
  errorCode?: string;
  missingScope?: string;
  latencyMs: number;
  requestId?: string;
}

/**
 * The self-serve debugging surface (design §11): "when an agent says 'it
 * didn't work', this is where the operator looks." Last ~200 calls, redacted
 * args already stripped server-side before storage (R-8.12.4) — this view
 * only ever renders what `apiRequestLog` persisted, never a raw payload.
 */
export function RequestLogDialog({
  open,
  onOpenChange,
  apiKeyId,
  keyName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiKeyId: string | null;
  keyName: string;
}) {
  const { data, isLoading } = useServerQuery({
    queryKey: ["api-key-request-log", apiKeyId],
    queryFn: () => getApiKeyRequestLog(apiKeyId!, 200),
    enabled: open && !!apiKeyId,
  });

  const entries = (data?.entries ?? []) as RequestLogEntry[];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Request log — {keyName}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-fg-3">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading...
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-fg-3">
            <FileClock className="mb-2 h-8 w-8 opacity-50" />
            <p className="font-medium">No calls yet</p>
            <p className="mt-1 text-xs">Requests made with this key will appear here.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {entries.map((entry, i) => (
              <div
                key={`${entry.requestId ?? i}-${entry.ts}`}
                className="flex flex-col gap-1 rounded-md border border-border p-2.5 text-xs sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Badge status={entry.status === "success" ? "ok" : "overbooked"}>
                    {entry.status}
                  </Badge>
                  <span className="truncate font-mono">{entry.operation}</span>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-fg-3">
                  {entry.errorCode && <span>{entry.errorCode}</span>}
                  {entry.missingScope && <span>missing: {entry.missingScope}</span>}
                  <span>{entry.latencyMs}ms</span>
                  <span>{formatDate(new Date(entry.ts))}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
