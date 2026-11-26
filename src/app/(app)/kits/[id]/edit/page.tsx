import { redirect } from "next/navigation";

/** The Kit sheet replaced this page (UX Phase 14): old links and bookmarks open it on the record. */
export default async function EditKitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/kits/${encodeURIComponent(id)}?edit=1`);
}
