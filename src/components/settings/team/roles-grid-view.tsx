"use client";
// use-client: expandable rows (R-8.1.1)

import * as React from "react";
import { Check, ChevronDown, ChevronRight, Minus } from "lucide-react";

import { useIsMobile } from "@/hooks/use-mobile";
import { buildRolesGrid, type GridRow, type RolesGrid } from "@/lib/roles-grid";
import { cn, focusRing } from "@/lib/utils";

function Tick({ granted }: { granted: boolean }) {
  return granted ? (
    <Check aria-label="Allowed" className="mx-auto size-4 text-t-ok" />
  ) : (
    <Minus aria-label="Not allowed" className="mx-auto size-4 text-muted" />
  );
}

function ResourceRows({ row, roles }: { row: GridRow; roles: RolesGrid["roles"] }) {
  const [open, setOpen] = React.useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <>
      <tr className="border-t border-line">
        <th scope="row" className="py-1 pr-2 text-left font-normal">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className={cn("flex min-h-10 w-full items-center gap-1 text-left text-table-cell text-ink hover:text-ink-2", focusRing)}
          >
            <Chevron aria-hidden="true" className="size-4 shrink-0 text-muted" />
            {row.label}
          </button>
        </th>
        {roles.map((r) => (
          <td key={r.key} className="px-2 text-center font-mono text-table-cell tabular-nums text-ink-2">
            {row.cells[r.key].text}
          </td>
        ))}
      </tr>
      {open
        ? row.cells[roles[0].key].actions.map((a, i) => (
            <tr key={a.key} className="bg-paper-2/40">
              <th scope="row" className="py-1 pl-7 pr-2 text-left text-table-cell font-normal text-muted">
                {a.label}
              </th>
              {roles.map((r) => (
                <td key={r.key} className="px-2 py-1">
                  <Tick granted={row.cells[r.key].actions[i].granted} />
                </td>
              ))}
            </tr>
          ))
        : null}
    </>
  );
}

function DesktopGrid({ grid }: { grid: RolesGrid }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse">
        <thead>
          <tr className="text-left text-badge font-semibold text-muted">
            <th className="py-2 pr-2">Resource</th>
            {grid.roles.map((r) => (
              <th key={r.key} className="px-2 text-center">
                {r.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row) => (
            <ResourceRows key={row.resource} row={row} roles={grid.roles} />
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line text-table-cell text-ink-2">
            <th scope="row" className="py-2 pr-2 text-left font-medium">
              Actions granted
            </th>
            {grid.roles.map((r) => (
              <td key={r.key} className="px-2 text-center font-mono tabular-nums">
                {r.granted}/{r.total}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Phone: the six roles as rows; each opens to what it can do per resource. */
function PhoneRoles({ grid }: { grid: RolesGrid }) {
  const [openRole, setOpenRole] = React.useState<string | null>(null);
  return (
    <ul className="border-y border-line">
      {grid.roles.map((r) => (
        <li key={r.key} className="border-t border-line first:border-t-0">
          <button
            type="button"
            aria-expanded={openRole === r.key}
            onClick={() => setOpenRole(openRole === r.key ? null : r.key)}
            className={cn("flex min-h-14 w-full items-center justify-between px-1 text-left", focusRing)}
          >
            <span className="text-ui-text font-medium text-ink">{r.label}</span>
            <span className="font-mono text-table-cell tabular-nums text-muted">
              {r.granted}/{r.total}
            </span>
          </button>
          {openRole === r.key ? (
            <ul className="pb-2 pl-1">
              {grid.rows.map((row) => (
                <li key={row.resource} className="flex items-center justify-between py-1 text-table-cell">
                  <span className="text-ink-2">{row.label}</span>
                  <span className="font-mono tabular-nums text-muted">{row.cells[r.key].text}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** The read-only roles & permissions grid (D58): computed from the real permission tables. */
export function RolesGridView() {
  const isMobile = useIsMobile();
  const grid = React.useMemo(() => buildRolesGrid(), []);
  return isMobile ? <PhoneRoles grid={grid} /> : <DesktopGrid grid={grid} />;
}
