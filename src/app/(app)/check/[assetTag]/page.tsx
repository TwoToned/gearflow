import { redirect } from "next/navigation";
import { scanHref } from "@/lib/scan-page";

/**
 * The ad-hoc check became the Scan page's Check mode (spec §9i, Phase 16). Old links,
 * bookmarks and printed QR codes keep working: this is a server redirect to
 * `/scan?mode=check&tag=…`, where the tag loads exactly as if it had been scanned.
 */
export default async function CheckRedirect({ params }: { params: Promise<{ assetTag: string }> }) {
  const { assetTag } = await params;
  redirect(scanHref({ mode: "check", tag: safeDecode(assetTag).trim() || null }));
}

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
