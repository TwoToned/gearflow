import { redirect } from "next/navigation";

/**
 * Edit is a sheet over the record now (UX Phase 12, D31/D62), so this old route is a
 * deep link that opens it: a unit's own page with `?edit=1`; bulk stock (`?type=bulk`)
 * has no page of its own, so the forward finds its model's page and opens the sheet there.
 */
export default async function EditAssetRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const type = (await searchParams).type;
  redirect(type === "bulk" ? `/assets/registry/${id}?type=bulk&edit=1` : `/assets/registry/${id}?edit=1`);
}
