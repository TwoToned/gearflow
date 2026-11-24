"use client";

/**
 * By person: the project crew list, kept (it is the only place a legacy
 * assignment with no service link shows) and given the column it was missing:
 * Service. Rows are the one `LineRow` (kind crew) with always-on checkboxes;
 * single-row verbs live in the row menu, bulk verbs in the bar. Phase group
 * headers stay; managers come first.
 */
import { LineRowList } from "@/components/ui/line-row";
import { getStatusIntent } from "@/lib/status-colors";
import { assignmentStatusLabels, phaseLabels } from "@/lib/status-labels";
import type { ActionMenuSpec, FactColumn, LineRowData, RowSelection } from "@/lib/primitives/types";

/* The project crew rows come from a Convex composite typed loosely at the boundary. */
export interface CrewAssignmentRow {
  id: string;
  status: string;
  phase?: string | null;
  isProjectManager?: boolean;
  serviceId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  estimatedCost?: number | null;
  crewMember: { id: string; firstName: string; lastName: string; email: string | null };
  crewRole?: { id: string; name: string } | null;
  service?: { id: string; title: string } | null;
}

export const PEOPLE_COLUMNS: FactColumn[] = [
  { id: "service", header: "Service" },
  { id: "when", header: "When" },
  { id: "cost", header: "Est. cost", align: "end" },
  { id: "status", header: "Status" },
];

const shortDay = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" }) : "";

export const assignmentName = (a: CrewAssignmentRow) => a.crewMember.firstName + " " + a.crewMember.lastName;

const money = (n?: number | null): number | null => (n != null && n > 0 ? n : null);

function whenText(a: CrewAssignmentRow): string {
  const to = a.endDate && a.endDate !== a.startDate ? shortDay(a.endDate) : "";
  const days = [shortDay(a.startDate), to].filter(Boolean).join(" – ");
  const times = [a.startTime, a.endTime].filter(Boolean).join(" – ");
  return [days, times].filter(Boolean).join(" · ") || "—";
}

function crewTags(a: CrewAssignmentRow): string[] {
  return [a.crewRole?.name, a.crewMember.email ? "" : "no email"].filter((t): t is string => !!t);
}

export function crewRow(
  a: CrewAssignmentRow,
  opts: { conflict?: { severity: "hard" | "soft"; label: string }; menu?: ActionMenuSpec; onOpen?: () => void },
): LineRowData {
  const { conflict } = opts;
  return {
    id: a.id,
    kind: "crew",
    title: assignmentName(a),
    tags: crewTags(a),
    flags: conflict ? [{ label: conflict.label, tone: conflict.severity === "hard" ? "error" : "warning" }] : undefined,
    facts: {
      service: { kind: "text", label: a.service?.title ?? "No service" },
      when: { kind: "time", at: whenText(a) },
      // `projectCrew` strips the cost below the pay line: then the cell is absent too.
      ...(a.estimatedCost !== undefined ? { cost: { kind: "money" as const, amount: money(a.estimatedCost) } } : {}),
    },
    status: { label: assignmentStatusLabels[a.status] ?? a.status, intent: getStatusIntent("assignment", a.status) },
    menu: opts.menu,
    onOpen: opts.onOpen,
  };
}

/** Managers first, then phase groups in the order they first appear; no phase last. */
export function groupCrew(rows: CrewAssignmentRow[]): { title: string; rows: CrewAssignmentRow[] }[] {
  const groups = new Map<string, CrewAssignmentRow[]>();
  const push = (key: string, r: CrewAssignmentRow) => groups.set(key, [...(groups.get(key) ?? []), r]);
  for (const r of rows) push(r.isProjectManager ? "Project managers" : r.phase ? (phaseLabels[r.phase] ?? r.phase) : "Other", r);
  const order = ["Project managers", ...[...groups.keys()].filter((k) => k !== "Project managers" && k !== "Other"), "Other"];
  return order.filter((k) => groups.has(k)).map((title) => ({ title, rows: groups.get(title)! }));
}

export function PeopleView({
  rows, selection, rowFor,
}: { rows: CrewAssignmentRow[]; selection: RowSelection; rowFor: (a: CrewAssignmentRow) => LineRowData }) {
  if (rows.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-ui-text font-medium text-ink-2">No crew booked yet</p>
        <p className="text-caption text-muted">Add a service, then pick crew from its row menu. That is also where their rate gets set.</p>
      </div>
    );
  }
  return (
    <div>
      {groupCrew(rows).map((g, i) => (
        <section key={g.title} aria-label={g.title}>
          <h3 className="t-overline mt-4 text-ink first:mt-1">
            {g.title}
            <span className="t-mono ml-2 font-normal text-muted">{g.rows.length}</span>
          </h3>
          <LineRowList
            rows={g.rows.map(rowFor)}
            columns={PEOPLE_COLUMNS}
            selection={selection}
            className={i > 0 ? "[&_thead]:hidden" : undefined}
          />
        </section>
      ))}
    </div>
  );
}
