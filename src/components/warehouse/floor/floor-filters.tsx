"use client";

import { useMemo } from "react";
import { FilterWord, type ListFilterDef } from "@/components/ui/list-page-parts";
import { FLOOR_FLAG_KEYS, FLOOR_FLAG_LABELS, NO_PACKER, type FloorJob, type FloorUrlState } from "@/lib/warehouse-floor";

type FilterKey = "client" | "flags" | "packer";

/**
 * The floor's filter words, `Client ▾ · Flags ▾ · Packer ▾` (spec §9c.2),
 * built on 6b's ONE `FilterWord` (no local copy, R-3.1). Their state lives in
 * the URL (`client`, `flags`, `packer`); clients come from the jobs on the
 * board, packers from the org roster.
 */
export function FloorFilters({ jobs, members, state, update }: {
  jobs: readonly FloorJob[];
  members: ReadonlyArray<{ id: string; name: string }>;
  state: Pick<FloorUrlState, FilterKey>;
  update: (patch: Partial<Pick<FloorUrlState, FilterKey>>) => void;
}) {
  const defs = useMemo<ListFilterDef[]>(() => {
    const clients = new Map<string, string>();
    for (const j of jobs) if (j.clientId && j.client?.name) clients.set(j.clientId, j.client.name);
    return [
      { key: "client", label: "Client", options: [...clients].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)) },
      { key: "flags", label: "Flags", options: FLOOR_FLAG_KEYS.map((k) => ({ value: k, label: FLOOR_FLAG_LABELS[k] })) },
      { key: "packer", label: "Packer", options: [...members.map((m) => ({ value: m.id, label: m.name })), { value: NO_PACKER, label: "No packer" }] },
    ];
  }, [jobs, members]);

  return (
    <span className="flex items-center gap-3">
      {defs.map((d) => (
        <FilterWord
          key={d.key}
          def={d}
          chosen={state[d.key as FilterKey]}
          onChange={(values) => update({ [d.key]: values } as Partial<Pick<FloorUrlState, FilterKey>>)}
        />
      ))}
    </span>
  );
}
