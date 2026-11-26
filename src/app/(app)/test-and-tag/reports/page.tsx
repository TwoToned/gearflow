import { redirect } from "next/navigation";

/** Reports is a dialog on the Test & tag page now (UX Phase 14, 14a-3b, D44): old links and bookmarks open it there. */
export default function TestTagReportsRedirect() {
  redirect("/test-and-tag?dialog=reports");
}
