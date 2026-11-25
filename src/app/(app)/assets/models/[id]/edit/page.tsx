import { redirect } from "next/navigation";

/** Edit is a sheet over the model's page now (UX Phase 12, D62): this old route is a deep link that opens it. */
export default async function EditModelRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/assets/models/${id}?edit-model=${id}`);
}
