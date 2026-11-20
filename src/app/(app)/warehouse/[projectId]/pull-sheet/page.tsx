import { redirect } from "next/navigation";

/**
 * The pull sheet became a dialog on the warehouse job (spec §9c.5). Old links
 * and bookmarks land on the job with the dialog open.
 */
export default async function PullSheetRedirect({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  redirect(`/warehouse/${encodeURIComponent(projectId)}?doc=pull-sheet`);
}
