import { redirect } from "next/navigation";

/**
 * Create is a sheet over the Assets list now (UX Phase 12, D31/D62), so this old route is
 * a deep link that opens it: `?type=serialized|bulk` picks the words, `?modelId=` presets
 * the model. Old links, bookmarks, the ⌘K command and the dashboard buttons keep working.
 */
export default async function NewAssetRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const kind = first(sp.type) === "bulk" ? "bulk" : "serialized";
  const modelId = first(sp.modelId);
  redirect(`/assets/registry?new=${kind}${modelId ? `&modelId=${encodeURIComponent(modelId)}` : ""}`);
}
