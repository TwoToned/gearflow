"use client";
// Extracted out of `/today/page.tsx` (FEATUREDOCS/79) so the "needs you" rail
// can also live on the dashboard board (#1267) — same one-shot-polled hook +
// writes, same presentational `TodayNeedsYouRail` (R-3.1).

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useFocusPolledQuery } from "@/hooks/use-focus-polled-query";
import { useWorkSignalWrites } from "@/hooks/use-work-signal-writes";
import { sendCrewOffer } from "@/server/crew-communication";
import { TodayNeedsYouRail } from "@/components/today/today-needs-you-rail";
import { api } from "../../../../convex/_generated/api";

const MINUTE = 60_000;

export function TodayNeedsYouRailWidget({
  orgId,
  /** See the identical default on `TodayDayRailWidget`: `true` for the
   *  dashboard-board registry, `false` from `/today/page.tsx` (its own
   *  card + "Needs you" heading). */
  bare = true,
}: {
  orgId: string | undefined;
  bare?: boolean;
}) {
  const signalWrites = useWorkSignalWrites();
  const nowBucket = Math.floor(Date.now() / MINUTE) * MINUTE;
  const needsYou = useFocusPolledQuery(api.dashboardLists.needsYou, orgId ? { orgId, now: nowBucket } : "skip");

  const snoozeSignal = useCallback(
    (sourceKey: string) => {
      signalWrites.snooze(sourceKey).then(needsYou.refresh).catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : "Could not snooze");
      });
    },
    [signalWrites, needsYou.refresh],
  );

  const [reofferingAssignmentId, setReofferingAssignmentId] = useState<string | null>(null);
  const reofferCrew = useCallback(
    (assignmentId: string) => {
      setReofferingAssignmentId(assignmentId);
      sendCrewOffer(assignmentId)
        .then(() => {
          toast.success("Offer sent");
          return needsYou.refresh();
        })
        .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Could not send the offer"))
        .finally(() => setReofferingAssignmentId(null));
    },
    [needsYou.refresh],
  );

  return (
    <TodayNeedsYouRail
      data={needsYou.data}
      asOf={needsYou.asOf}
      error={needsYou.error}
      onRefresh={needsYou.refresh}
      onSnooze={snoozeSignal}
      onReoffer={reofferCrew}
      reofferingAssignmentId={reofferingAssignmentId}
      bare={bare}
    />
  );
}
