"use client";

import { Badge } from "@/components/ui/badge";
import type { LineItem } from "./warehouse-types";

export function PrepStatusBadge({ item }: { item: LineItem }) {
  if (item.prepStatus === "PACKED") {
    return <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">Prepped</Badge>;
  }
  if (item.prepStatus === "PULLED") {
    return <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/20">Pulled</Badge>;
  }
  return <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20">Needs prep</Badge>;
}
