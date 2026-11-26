import { redirect } from "next/navigation";

/** Edit is a sheet over the client page now (UX Phase 13): this old route is a deep link that opens it. */
export default async function EditClientRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/clients/${id}?edit=1`);
}
