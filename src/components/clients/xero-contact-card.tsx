"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Search, Link2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useXeroLinked } from "@/hooks/use-xero-linked";
import { searchXeroContactsAction, linkXeroContact, unlinkXeroContact } from "@/server/xero";
import { useServerMutation } from "@/hooks/use-server-mutation";

interface XeroContactResult {
  ContactID: string;
  Name: string;
  EmailAddress?: string;
}

interface XeroContactCardProps {
  clientId: string;
  xeroContactId?: string | null;
  xeroContactName?: string | null;
}

/**
 * WS1 (#940) — client <-> Xero contact mapping card. Xero-linked-only:
 * `useXeroLinked()` gates the WHOLE card, not just individual fields — an
 * unlinked org sees nothing here (the stored mapping, if any, is retained
 * but inert). Search / link / unlink / re-map. Auto-create-on-push (when a
 * client is pushed unmapped) happens server-side in pushInvoiceToXero and
 * shows up here automatically once it runs (the card re-reads the client's
 * xeroContactId/Name on refresh).
 */
export function XeroContactCard({ clientId, xeroContactId, xeroContactName }: XeroContactCardProps) {
  const linked = useXeroLinked();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<XeroContactResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  const linkMutation = useServerMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => linkXeroContact(clientId, id, name),
    onSuccess: () => {
      toast.success("Linked to Xero contact");
      setResults(null);
      setQuery("");
    },
    onError: (e) => toast.error(e.message),
  });
  const unlinkMutation = useServerMutation({
    mutationFn: () => unlinkXeroContact(clientId),
    onSuccess: () => toast.success("Unlinked from Xero"),
    onError: (e) => toast.error(e.message),
  });

  if (!linked) return null;

  async function runSearch() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const found = await searchXeroContactsAction(query.trim());
      setResults(found);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  if (xeroContactId && !results) {
    return (
      <div className="space-y-2 text-table-cell">
        <div className="flex items-center gap-1.5 text-fg">
          <Link2 className="h-3.5 w-3.5 text-faint" />
          <span className="font-medium">{xeroContactName ?? xeroContactId}</span>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="line" size="sm" onClick={() => setResults([])}>
            Re-map
          </Button>
          <Button
            type="button"
            variant="line"
            size="sm"
            loading={unlinkMutation.isPending}
            onClick={() => unlinkMutation.mutate(undefined)}
          >
            <Unlink className="h-3.5 w-3.5" /> Unlink
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Xero contacts…"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void runSearch();
            }
          }}
        />
        <Button type="button" variant="line" size="sm" loading={searching} onClick={() => void runSearch()}>
          <Search className="h-3.5 w-3.5" />
        </Button>
      </div>
      {results && (
        <ul className="space-y-1">
          {results.length === 0 && <li className="text-caption text-faint">No matches.</li>}
          {results.map((r) => (
            <li key={r.ContactID} className="flex items-center justify-between gap-2 rounded-[var(--r)] border border-line px-2 py-1.5 text-table-cell">
              <div className="min-w-0">
                <p className="truncate font-medium text-fg">{r.Name}</p>
                {r.EmailAddress && <p className="truncate text-caption text-faint">{r.EmailAddress}</p>}
              </div>
              <Button
                type="button"
                size="sm"
                loading={linkMutation.isPending}
                onClick={() => linkMutation.mutate({ id: r.ContactID, name: r.Name })}
              >
                Link
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
