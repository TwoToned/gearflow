import { redirect } from "next/navigation";
import { returnsRedirectHref } from "@/lib/warehouse-floor";

/**
 * The returns station became the floor's Returning mode (spec §9c.4, D26).
 * Old links and bookmarks keep working: this is a server redirect to
 * `/warehouse?mode=returning`, carrying any query string along.
 *
 * (This static segment still shadows a project whose cuid is literally
 * "returns" at `/warehouse/[projectId]`; cuid2 ids never are.)
 */
export default async function ReturnsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(returnsRedirectHref(await searchParams));
}
