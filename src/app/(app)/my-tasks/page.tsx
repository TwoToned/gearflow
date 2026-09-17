import { redirect } from "next/navigation";

/**
 * Superseded by Today (work-layer phase 0.5, #1242) — Today assembles the
 * same "my open tasks across every project" read plus mentions, a day rail
 * and a needs-you rail. Kept as a redirect rather than deleted so old
 * bookmarks/links/the ⌘K "My tasks" muscle memory still land somewhere real.
 */
export default function MyTasksPage() {
  redirect("/today");
}
