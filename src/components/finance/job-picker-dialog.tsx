"use client";
// use-client: search state and a live query (R-8.1.1)

import * as React from "react";
import { useRouter } from "next/navigation";

import { api } from "../../../convex/_generated/api";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { cn } from "@/lib/utils";

type Kind = "invoice" | "quote";
interface JobHit {
  id: string;
  projectNumber: string;
  name: string;
  client?: { name: string | null } | null;
}

const COPY: Record<Kind, { word: string; hint: string }> = {
  invoice: { word: "Invoice", hint: "Pick the job to raise an invoice for. You'll land on its Finance tab, where invoicing starts." },
  quote: { word: "Quote", hint: "Pick the job to quote. You'll land on its Finance tab, where a quote is sent." },
};

/**
 * `+ New` on the hub (spec §9j.2): creation is the one verb with no row to hang off, so a search-first job
 * picker. A quote or invoice is always made FROM a job, with its own price and gates, so the picker only
 * chooses the job and opens that job's Finance tab; it creates nothing itself.
 */
export function JobPickerDialog({ open, onOpenChange, orgId, kinds }: { open: boolean; onOpenChange: (open: boolean) => void; orgId: string | undefined; kinds: Kind[] }) {
  const router = useRouter();
  const [kind, setKind] = React.useState<Kind>(kinds[0] ?? "invoice");
  const [search, setSearch] = React.useState("");
  const active = kinds.includes(kind) ? kind : kinds[0];
  const result = useAuthedQuery(api.projects.listPage, open && orgId ? { orgId, search: search.trim() || undefined, page: 1, pageSize: 8, sortBy: "createdAt", sortOrder: "desc" } : "skip");
  const hits = (result?.items ?? []) as unknown as JobHit[];

  const pick = (id: string) => {
    onOpenChange(false);
    router.push(`/projects/${id}?tab=finance`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New {COPY[active].word.toLowerCase()} for a job</DialogTitle>
          <DialogDescription>{COPY[active].hint}</DialogDescription>
        </DialogHeader>
        {kinds.length > 1 ? (
          <div role="radiogroup" aria-label="What to make" className="flex gap-4">
            {kinds.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={active === k}
                onClick={() => setKind(k)}
                className={cn("inline-flex min-h-11 items-center border-b-2 text-ui-text font-medium md:min-h-9", active === k ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink")}
              >
                {COPY[k].word}
              </button>
            ))}
          </div>
        ) : null}
        <Input aria-label="Search jobs" autoFocus placeholder="Search job number, name or client" value={search} onChange={(e) => setSearch(e.target.value)} className="text-base md:text-ui-text" />
        <ul className="max-h-64 divide-y divide-line overflow-y-auto border-y border-line">
          {result === undefined ? <li className="py-3 t-small text-muted">Searching…</li> : null}
          {result !== undefined && hits.length === 0 ? <li className="py-3 t-small text-muted">No jobs match.</li> : null}
          {hits.map((j) => (
            <li key={j.id}>
              <button type="button" onClick={() => pick(j.id)} className="flex min-h-12 w-full items-center justify-between gap-3 px-1 text-left hover:bg-elev">
                <span className="min-w-0 truncate text-ui-text font-medium text-ink">
                  {j.projectNumber} · {j.name}
                </span>
                <span className="shrink-0 t-micro text-muted">{j.client?.name ?? "No client"}</span>
              </button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button type="button" variant="line" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
