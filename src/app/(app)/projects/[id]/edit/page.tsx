import { redirect } from "next/navigation";
import { jobEditHref } from "@/lib/job-edit-url";

/**
 * `/projects/[id]/edit` is a deep link now, not a page (D22): the job edit is a
 * sheet over the record (`?edit=1`). Kept so the slash command, emails, bookmarks
 * and the Overview `Edit` links keep working.
 */
export default async function EditProjectRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(jobEditHref(`/projects/${id}`));
}
