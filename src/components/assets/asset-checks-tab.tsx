"use client";

import { useState } from "react";
import { useServerQuery } from "@/hooks/use-server-query";
import {
  Loader2,
  ClipboardCheck,
  CheckCircle2,
  XCircle,
  FileText,
  Camera,
} from "lucide-react";
import Link from "next/link";

import { getCheckHistory } from "@/server/check-records";
import { useActiveOrganization } from "@/lib/auth-client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ContextFilter = "ALL" | "PREP" | "RETURN" | "AD_HOC";

const CONTEXT_LABELS: Record<string, string> = {
  PREP: "Prep",
  RETURN: "Return",
  AD_HOC: "Ad Hoc",
};

const RESULT_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  PASS: { icon: CheckCircle2, color: "text-green-500", label: "Pass" },
  FAIL: { icon: XCircle, color: "text-destructive", label: "Fail" },
  NOTES_ONLY: { icon: FileText, color: "text-blue-500", label: "Notes" },
};

export function AssetChecksTab({ assetId }: { assetId: string }) {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const [filter, setFilter] = useState<ContextFilter>("ALL");

  const { data: records = [], isLoading } = useServerQuery({
    queryKey: ["asset-check-history", orgId, assetId, filter],
    queryFn: () => getCheckHistory(assetId, filter === "ALL" ? undefined : filter),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-fg-3">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading...
      </div>
    );
  }

  const items = records as Record<string, unknown>[];

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-2">
        {(["ALL", "PREP", "RETURN", "AD_HOC"] as ContextFilter[]).map((ctx) => (
          <Button
            key={ctx}
            variant={filter === ctx ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(ctx)}
          >
            {ctx === "ALL" ? "All" : CONTEXT_LABELS[ctx]}
          </Button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-fg-3">
          <ClipboardCheck className="mb-2 h-8 w-8 opacity-50" />
          <p className="font-medium">No check records yet</p>
          <p className="mt-1 text-xs">
            Check results will appear here after warehouse prep or return.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groupBySession(items).map((session) => (
            <div key={session.key} className="rounded-lg bg-bg-surface surface-ring overflow-hidden">
              {/* Session header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {CONTEXT_LABELS[session.context] || session.context}
                  </Badge>
                  {session.project && (
                    <Link
                      href={`/warehouse/${(session.project as Record<string, unknown>).id}`}
                      className="text-xs text-primary hover:underline"
                    >
                      {(session.project as Record<string, unknown>).projectNumber as string} — {(session.project as Record<string, unknown>).name as string}
                    </Link>
                  )}
                </div>
                <div className="text-xs text-fg-3">
                  {session.performedBy && <span>{session.performedBy} · </span>}
                  {new Date(session.performedAt).toLocaleDateString("en-AU", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>

              {/* Check items in this session */}
              <div className="divide-y divide-border">
                {session.records.map((record) => {
                  const result = RESULT_CONFIG[record.result] || RESULT_CONFIG.NOTES_ONLY;
                  const ResultIcon = result.icon;
                  return (
                    <div key={record.id} className="flex items-center gap-3 px-4 py-2.5">
                      <ResultIcon className={`h-4 w-4 shrink-0 ${result.color}`} />
                      <div className="min-w-0 flex-1">
                        <span className="text-sm font-medium">{record.label}</span>
                        {record.value && (
                          <span className="ml-2 text-xs text-fg-3">
                            {record.value}
                          </span>
                        )}
                        {record.notes && (
                          <p className="mt-0.5 text-xs text-fg-3 line-clamp-1">{record.notes}</p>
                        )}
                      </div>
                      {record.photos.length > 0 && (
                        <div className="flex items-center gap-1 text-fg-3">
                          <Camera className="h-3 w-3" />
                          <span className="text-[10px]">{record.photos.length}</span>
                        </div>
                      )}
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {result.label}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Group Records by Session ─────────────────────────────────────────────────

type SessionRecord = {
  id: string;
  result: string;
  label: string;
  value: string | null;
  notes: string | null;
  photos: string[];
};

type Session = {
  key: string;
  context: string;
  performedAt: string;
  performedBy: string | null;
  project: Record<string, unknown> | null;
  records: SessionRecord[];
};

function groupBySession(items: Record<string, unknown>[]): Session[] {
  const sessions = new Map<string, Session>();

  for (const item of items) {
    const performedAt = item.performedAt as string;
    const context = item.context as string;
    const performedBy = item.performedBy as Record<string, unknown> | null;
    const checkItem = item.checkItem as Record<string, unknown>;
    const lineItem = item.lineItem as Record<string, unknown> | null;
    const project = lineItem?.project as Record<string, unknown> | null;

    // Group by same context + performer + time (within 60 seconds)
    const timeKey = new Date(performedAt).toISOString().slice(0, 16); // minute precision
    const key = `${context}-${timeKey}-${performedBy?.name || "unknown"}`;

    if (!sessions.has(key)) {
      sessions.set(key, {
        key,
        context,
        performedAt,
        performedBy: performedBy?.name as string | null,
        project,
        records: [],
      });
    }

    sessions.get(key)!.records.push({
      id: item.id as string,
      result: item.result as string,
      label: checkItem.label as string,
      value: item.value as string | null,
      notes: item.notes as string | null,
      photos: (item.photos as string[]) || [],
    });
  }

  return Array.from(sessions.values());
}
