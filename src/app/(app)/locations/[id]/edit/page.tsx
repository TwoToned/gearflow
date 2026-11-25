import { redirect } from "next/navigation";

/** The Location sheet replaced this page (UX Phase 14): old links and bookmarks open it on the record. */
export default async function EditLocationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/locations/${encodeURIComponent(id)}?edit=1`);
}
