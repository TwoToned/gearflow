"use client";

import { Badge } from "@/components/ui/badge";
import type { LineItem } from "./warehouse-types";

export function PrepStatusBadge({ item }: { item: LineItem }) {
  if (item.prepStatus === "PACKED") {
    return <Badge status="ok">Prepped</Badge>;
  }
  if (item.prepStatus === "PULLED") {
    // Info/in-progress — Badge is status-only, so the blue info pill comes
    // from status-colors tokens (bg-blue-soft text-blue) layered on neutral.
    return <Badge status="neutral" className="bg-blue-soft text-blue">Pulled</Badge>;
  }
  return <Badge status="warn">Needs prep</Badge>;
}
