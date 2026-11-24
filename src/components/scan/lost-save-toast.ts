"use client";

import { toast } from "sonner";

/**
 * A save that failed AFTER the page moved on to another tag (a scan landed mid-save,
 * review SF3's follow-up). The error must name whose answers were lost, since the screen
 * now shows a different item, and offer Retry: the answers were captured when Save was
 * pressed, so Retry sends exactly those again. Retry runs once (a second click does
 * nothing), so it can't save the same check twice.
 */
export function announceLostSave(tag: string, kind: "check" | "test", e: unknown, retry: () => Promise<unknown>): void {
  const why = e instanceof Error && e.message ? e.message : "Something went wrong.";
  let tried = false;
  toast.error(`${kind === "check" ? "Check" : "Test"} on ${tag} wasn't saved`, {
    description: `${why} Its answers are kept: Retry sends them again.`,
    duration: 15_000,
    action: {
      label: "Retry",
      onClick: () => {
        if (tried) return;
        tried = true;
        void retry();
      },
    },
  });
}
