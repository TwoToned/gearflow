"use client";

import { Badge } from "@/components/ui/badge";
import { intentToBadgeStatus, getStatusIntent } from "@/lib/status-colors";
import { GEAR_STAGE_LABELS } from "@/lib/vocabulary";
import type { LineItem } from "./warehouse-types";

import type { GearStageKey } from "@/lib/vocabulary";

/** A gear-stage chip: word from vocabulary, colour from the one stage table. */
export function GearStageBadge({ stage }: { stage: GearStageKey }) {
  return (
    <Badge status={intentToBadgeStatus(getStatusIntent("gearStage", stage))}>
      {GEAR_STAGE_LABELS[stage]}
    </Badge>
  );
}

/**
 * Pick-stage chip (UX D2/D90). PACKED is "Prepped"; PENDING and PULLED are both
 * "To pick" (Prepped means packed and waiting), so a PULLED row keeps its
 * "Pulled" sub-hint instead of losing that information.
 */
export function PrepStatusBadge({ item }: { item: LineItem }) {
  const packed = item.prepStatus === "PACKED";
  // A returned unit keeps prepStatus PACKED until de-prepped, so status wins:
  // reading it as "Prepped" showed returned gear with a Prepped chip (spec §1.1).
  const stage: GearStageKey = item.status === "RETURNED" ? "returned" : packed ? "prepped" : "to_prep";
  const status = intentToBadgeStatus(getStatusIntent("gearStage", stage));
  return (
    <Badge status={status}>
      {GEAR_STAGE_LABELS[stage]}
      {item.prepStatus === "PULLED" && (
        <span className="ml-1 font-normal opacity-75">· pulled</span>
      )}
    </Badge>
  );
}
