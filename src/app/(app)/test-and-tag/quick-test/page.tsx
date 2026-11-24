import { redirect } from "next/navigation";
import { scanHref } from "@/lib/scan-page";

/**
 * The quick-test wizard became the Scan page's Test & tag mode (spec §9i, Phase 16).
 * Old links (`?id=TT-0412` from the item page, bookmarks, the palette) keep working:
 * a server redirect to `/scan?mode=tt&tag=…`, where the item loads as if scanned.
 */
export default async function QuickTestRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await searchParams;
  const tag = (Array.isArray(id) ? id[0] : id)?.trim() || null;
  redirect(scanHref({ mode: "tt", tag }));
}
