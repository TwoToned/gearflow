"use client";

import * as React from "react";

import { api } from "../../../convex/_generated/api";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

export interface AssignJob {
  id: string;
  projectNumber: string;
  name: string;
  startDate?: number | null;
  endDate?: number | null;
}

/**
 * `Assign n to job…` (spec §9f.2): a search-first job picker. Choosing a job creates a
 * PENDING, UNSENT call per person over the job's rental window (offers go out later,
 * after their own confirm), so the one Undo removes exactly those calls.
 */
export function AssignToJobDialog({
  open,
  onOpenChange,
  orgId,
  count,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | undefined;
  count: number;
  onPick: (job: AssignJob) => void;
}) {
  const [search, setSearch] = React.useState("");
  const q = useDebouncedValue(search, 200);
  const page = useAuthedQuery(api.projects.listPage, open && orgId ? { orgId, search: q.trim() || undefined, segment: "all", pageSize: 8, sortBy: "rentalStartDate", sortOrder: "desc" } : "skip");
  const jobs = (page?.items ?? []) as { id: string; projectNumber: string; name: string; rentalStartDate?: number | null; rentalEndDate?: number | null; client?: { name: string | null } | null }[];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign {count} to a job</DialogTitle>
          <DialogDescription>Calls are created unsent. Send the offers from the planner or a person&apos;s row when you are ready.</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          type="search"
          aria-label="Search jobs"
          placeholder="Search job, number or client"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-11 text-base md:h-9 md:text-ui-text"
        />
        <ul className="max-h-72 divide-y divide-line overflow-y-auto">
          {jobs.length === 0 && <li className="py-3 text-ui-text text-muted">{page ? "No jobs match." : "Loading…"}</li>}
          {jobs.map((j) => (
            <li key={j.id}>
              <Button
                variant="ghost"
                className="h-auto min-h-11 w-full justify-start gap-2 whitespace-normal px-1 py-2 text-left"
                onClick={() => {
                  onPick({ id: j.id, projectNumber: j.projectNumber, name: j.name, startDate: j.rentalStartDate, endDate: j.rentalEndDate });
                  onOpenChange(false);
                }}
              >
                <span className="t-mono text-muted">{j.projectNumber}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{j.name}</span>
                {j.client?.name && <span className="truncate text-caption text-muted">{j.client.name}</span>}
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
