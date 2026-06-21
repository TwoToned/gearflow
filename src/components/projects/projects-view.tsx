"use client";

import { ProjectTable } from "./project-table";

/**
 * Projects list — a dense power table (filters, saved views, column prefs).
 * The Board view was removed; the page now shows the table directly.
 */
export function ProjectsView() {
  return <ProjectTable />;
}
