"use client";
// use-client: interactive search + expandable per-client mapping (R-8.1.1)

import { useState } from "react";
import { Search, Link2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useActiveOrganization } from "@/lib/auth-client";
import { useClientSearch } from "@/hooks/use-clients";
import { XeroContactCard } from "@/components/clients/xero-contact-card";

/**
 * WS1 (#940) — centralized client<->Xero contact mapping, replacing the old
 * per-client-detail-page card (moved here per user request: one searchable
 * list instead of visiting each client individually). Reuses
 * `XeroContactCard` unchanged for the actual search/link/unlink UI — only
 * the list-and-search shell around it is new, so there's one definition of
 * "how to map a client to a Xero contact," not two.
 */
export function XeroClientMapping() {
  const { data: activeOrg } = useActiveOrganization();
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const clients = useClientSearch(activeOrg?.id, query);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-3" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clients…"
          className="pl-8"
        />
      </div>
      <div className="max-h-96 divide-y divide-line overflow-y-auto rounded-[var(--r)] border border-line">
        {clients === undefined ? (
          <p className="p-3 text-table-cell text-fg-3">Loading…</p>
        ) : clients.length === 0 ? (
          <p className="p-3 text-table-cell text-fg-3">No clients found.</p>
        ) : (
          clients.map((c) => {
            const xeroContactId = c.xeroContactId as string | null | undefined;
            const xeroContactName = c.xeroContactName as string | null | undefined;
            const isExpanded = expandedId === c.id;
            return (
              <div key={c.id} className="p-3">
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : c.id)}
                  className="flex w-full items-center justify-between gap-2 text-left"
                >
                  <span className="min-w-0 truncate font-medium text-fg">{c.name}</span>
                  {xeroContactId ? (
                    <Badge status="ok">
                      <Link2 className="h-3 w-3" /> {xeroContactName ?? "Linked"}
                    </Badge>
                  ) : (
                    <Badge status="neutral">Not linked</Badge>
                  )}
                </button>
                {isExpanded && (
                  <div className="mt-3">
                    <XeroContactCard
                      clientId={c.id}
                      xeroContactId={xeroContactId}
                      xeroContactName={xeroContactName}
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
