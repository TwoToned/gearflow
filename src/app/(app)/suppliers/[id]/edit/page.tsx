import { redirect } from "next/navigation";

/** Edit is a sheet over the supplier page now (UX Phase 13): this old route is a deep link that opens it. */
export default async function EditSupplierRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/suppliers/${id}?edit=1`);
}
