import { redirect } from "next/navigation";

/**
 * Hidden (D10C) — Today's three widgets (work list, day rail, needs-you rail)
 * moved onto the customizable Dashboard's default board instead
 * (`src/lib/dashboard-widgets.ts`), so `/dashboard` now carries everything
 * this page used to show. Kept as a redirect rather than deleted so old
 * bookmarks/links/the ⌘K "Today" muscle memory still land somewhere real —
 * same pattern as `/my-tasks` below.
 */
export default function TodayPage() {
  redirect("/dashboard");
}
