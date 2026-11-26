import { redirect } from "next/navigation";

/** The Kit sheet replaced this page (UX Phase 14): old links and bookmarks land on the list with it open. */
export default function NewKitPage() {
  redirect("/kits?new=1");
}
