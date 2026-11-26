import { redirect } from "next/navigation";

/** Edit is a sheet over the crew record now (UX Phase 13): this old route is a deep link that opens it. */
export default async function EditCrewRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/crew/${id}?edit=1`);
}
