"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { RequirePermission } from "@/components/auth/require-permission";
import { getChangelog, type ChangelogEntry } from "@/server/changelog";

export default function ChangelogPage() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getChangelog().then(setEntries).finally(() => setLoading(false));
  }, []);

  return (
    <RequirePermission resource="asset" action="read">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-8">
          <h1 className="t-title">Changelog</h1>
          <p className="mt-2 text-fg-3">
            Build history for GearFlow.
          </p>
        </div>

        {loading ? (
          <div className="py-20 text-center text-fg-3">Loading...</div>
        ) : (
          <div className="relative">
            {entries.map((entry, i) => (
              <div key={entry.hash} className="relative">
                {/* Timeline connector */}
                <div className="absolute top-0 left-[19px] h-full w-px bg-border" />

                <div className="relative flex gap-4">
                  {/* Timeline dot */}
                  <div className="relative z-10 mt-1 flex-shrink-0">
                    <div
                      className={`h-[10px] w-[10px] rounded-full ring-4 ring-background ${
                        i === 0 ? "bg-primary" : "bg-fg-3/40"
                      }`}
                    />
                  </div>

                  <div className={`rounded-lg bg-bg-surface surface-ring mb-4 flex-1 ${i === 0 ? "ring-primary/30" : ""}`}>
                    <div className="p-4 pb-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          status="neutral"
                          className="font-mono text-xs"
                        >
                          {entry.hash}
                        </Badge>
                        {i === 0 && (
                          <Badge
                            status="neutral"
                            className="border-primary/40 text-primary text-xs"
                          >
                            Latest
                          </Badge>
                        )}
                        <span className="text-xs text-fg-3">
                          {entry.date}
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-medium">
                        {entry.message}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {/* Timeline end cap */}
            <div className="relative flex items-center gap-4 pb-4">
              <div className="relative z-10 flex-shrink-0">
                <div className="ml-[3px] h-1 w-1 rounded-full bg-fg-3/40" />
              </div>
            </div>
          </div>
        )}
      </div>
    </RequirePermission>
  );
}
