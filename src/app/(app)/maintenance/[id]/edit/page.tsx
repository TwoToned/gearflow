import { redirect } from "next/navigation";

/** The Maintenance sheet replaced this page (UX Phase 14): old links and bookmarks land on the job with it open. */
export default async function EditMaintenancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/maintenance/${encodeURIComponent(id)}?edit=1`);
}
