import { redirect } from "next/navigation";

/** A new order is a sheet over its supplier now (UX Phase 13): this old route is a deep link that opens it. */
export default async function NewOrderRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/suppliers/${id}?new-order=1`);
}
