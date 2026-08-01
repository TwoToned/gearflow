/**
 * The project's standing context — schedule, location, team — shaped once and
 * rendered two ways (#1063).
 *
 * The Overview tab weaves this into its own card language; every other tab
 * shows it in the page sidebar. Those are two presentations of the SAME facts,
 * so the rules about which facts exist live here rather than in either
 * renderer — otherwise the sidebar and the Overview cards could quietly
 * disagree about whether a project has a window (R-3.1).
 */

/**
 * The shape both renderers read off the project detail. Deliberately
 * structural rather than `Doc<"projects">` — the detail query returns a
 * serialized, relation-expanded row (dates as strings, `location`/`client`
 * joined), which is not the Convex document type.
 */
export interface ProjectContextProject {
  isTemplate?: boolean | null;
  rentalStartDate?: string | null;
  rentalEndDate?: string | null;
  projectStartDate?: string | null;
  projectEndDate?: string | null;
  projectStartTime?: string | null;
  projectEndTime?: string | null;
  loadInDate?: string | null;
  loadOutDate?: string | null;
  loadInTime?: string | null;
  loadOutTime?: string | null;
  location?: {
    name: string;
    address?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
  siteContactName?: string | null;
  siteContactPhone?: string | null;
  siteContactEmail?: string | null;
  client?: { id: string; name: string } | null;
  projectManagers?: {
    userId: string;
    user: { id: string; name: string | null; email: string; image: string | null };
  }[];
}

export interface ScheduleRow {
  label: string;
  date: string | null;
  time: string | null;
}

/**
 * The PROJECT window rows that are actually set.
 *
 * WS2 (#941): a row renders only when its date exists, so a project with no
 * window shows one honest line instead of a stack of "—" placeholders.
 * `loadInDate`/`loadOutDate` are the deprecated fallback for a row the
 * backfill hasn't reached yet.
 */
export function projectScheduleRows(project: ProjectContextProject): ScheduleRow[] {
  return [
    {
      label: "Project starts",
      date: project.projectStartDate ?? project.loadInDate ?? null,
      time: project.projectStartTime ?? project.loadInTime ?? null,
    },
    {
      label: "Project ends",
      date: project.projectEndDate ?? project.loadOutDate ?? null,
      time: project.projectEndTime ?? project.loadOutTime ?? null,
    },
  ].filter((r) => r.date != null);
}

/** Google Maps directions for a located project, or null when it has no pin. */
export function directionsHref(project: ProjectContextProject): string | null {
  const loc = project.location;
  if (!loc || loc.latitude == null || loc.longitude == null) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${loc.latitude},${loc.longitude}`;
}
