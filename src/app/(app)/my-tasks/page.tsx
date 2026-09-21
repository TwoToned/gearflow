import { redirect } from "next/navigation";

/**
 * Superseded by Dashboard (D10C, reversing work-layer phase 0.5/#1242) —
 * the "my open tasks across every project" read plus mentions, a day rail
 * and a needs-you rail are now widgets on the customizable dashboard board.
 * Kept as a redirect rather than deleted so old bookmarks/links/the ⌘K
 * "My tasks" muscle memory still land somewhere real.
 */
export default function MyTasksPage() {
  redirect("/dashboard");
}
