/**
 * "Where is it now?": the one question about a physical unit (UX Phase 12, §9d.2).
 * ONE pure function shared by the Overview's `Now` column, the context rail and the
 * header's dot-word, so they cannot drift (R-3.1). It is the five branches the old
 * page's locator had, including WS11 (#950)'s `Sold on {job}`.
 */
export interface WhereaboutsInput {
  status: string;
  location: { name: string } | null;
  lineItems: {
    id: string;
    projectId: string | null;
    type: string | null;
    status: string;
    returnedAt: Date | null;
    project: { name: string; projectNumber: string };
  }[];
}

interface JobRef {
  projectId: string;
  name: string;
  number: string;
  lineItemId: string;
}

export type Whereabouts =
  | { kind: "deployed"; job: JobRef; home: string | null }
  | { kind: "maintenance"; home: string | null }
  | { kind: "available"; home: string | null }
  | { kind: "sold"; job: JobRef }
  | { kind: "status"; status: string; home: string | null };

const ref = (li: WhereaboutsInput["lineItems"][number]): JobRef | null =>
  li.projectId ? { projectId: li.projectId, name: li.project.name, number: li.project.projectNumber, lineItemId: li.id } : null;

/** The line that has this unit out right now (not yet returned), else any CHECKED_OUT one. */
export function activeLine(a: WhereaboutsInput) {
  if (a.status !== "CHECKED_OUT") return null;
  return a.lineItems.find((li) => li.status === "CHECKED_OUT" && !li.returnedAt) ?? a.lineItems.find((li) => li.status === "CHECKED_OUT") ?? null;
}

/** The SALE line that sold this unit (non-cancelled preferred, any as a fallback). */
function soldLine(a: WhereaboutsInput) {
  if (a.status !== "SOLD") return null;
  return a.lineItems.find((li) => li.type === "SALE" && li.status !== "CANCELLED") ?? a.lineItems.find((li) => li.type === "SALE") ?? null;
}

export function whereaboutsOf(a: WhereaboutsInput): Whereabouts {
  const home = a.location?.name ?? null;
  const out = activeLine(a);
  const outJob = out && ref(out);
  if (outJob) return { kind: "deployed", job: outJob, home };
  if (a.status === "IN_MAINTENANCE") return { kind: "maintenance", home };
  if (a.status === "AVAILABLE") return { kind: "available", home };
  const sold = soldLine(a);
  const soldJob = sold && ref(sold);
  if (soldJob) return { kind: "sold", job: soldJob };
  return { kind: "status", status: a.status, home };
}

/** The sentence the Overview's `Now` column and the rail print (links are the caller's). */
export function whereaboutsText(w: Whereabouts, statusLabel: (s: string) => string): string {
  switch (w.kind) {
    case "deployed": return `Out on ${w.job.name} · ${w.job.number}`;
    case "sold": return `Sold on ${w.job.name} · ${w.job.number}`;
    case "maintenance": return w.home ? `In maintenance · home: ${w.home}` : "In maintenance";
    case "available": return w.home ? `Available · ${w.home}` : "Available · no home location set";
    case "status": return w.home ? `${statusLabel(w.status)} · ${w.home}` : statusLabel(w.status);
  }
}
