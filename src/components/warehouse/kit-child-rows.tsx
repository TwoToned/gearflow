"use client";

import { Fragment } from "react";
import {
  ChevronRight,
  Container,
  CircleCheck,
  Circle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  TableCell,
  TableRow,
} from "@/components/ui/table";

import type { LineItem } from "./warehouse-types";
import { PrepStatusBadge } from "./prep-status-badge";

export function KitChildRows({
  kitChildren,
  verifiedKitItems,
  expandedGroups,
  toggleExpanded,
  onToggleVerify,
  mode,
}: {
  kitChildren: LineItem[];
  verifiedKitItems: Set<string>;
  expandedGroups: Set<string>;
  toggleExpanded: (key: string) => void;
  onToggleVerify: (assetId: string) => void;
  mode: "deploy" | "return";
}) {
  return (
    <>
      {kitChildren.map((child) => {
        const isVerified = verifiedKitItems.has(child.id);
        const isNestedKit = !!child.kitId && (child.childLineItems?.length ?? 0) > 0;
        const nestedExpanded = expandedGroups.has(`nested-${child.id}`);

        // Filter nested kit grandchildren based on deploy/return mode
        const allGrandchildren = isNestedKit ? (child.childLineItems as LineItem[]) : [];
        const filteredGrandchildren = isNestedKit
          ? mode === "deploy"
            ? allGrandchildren.filter((gc) => gc.status !== "CHECKED_OUT" && gc.status !== "CANCELLED")
            : allGrandchildren.filter((gc) => gc.status === "CHECKED_OUT")
          : [];

        // For nested kits: detect partial deployment
        const nestedKitPartial = isNestedKit
          && allGrandchildren.some((gc) => gc.status === "CHECKED_OUT")
          && allGrandchildren.some((gc) => gc.status !== "CHECKED_OUT" && gc.status !== "CANCELLED");

        // Skip nested kits with no relevant grandchildren in this mode
        if (isNestedKit && filteredGrandchildren.length === 0) return null;

        return (
          <Fragment key={child.id}>
            <TableRow
              className={`${isVerified ? "bg-green-500/5" : "bg-bg-inset/30"} ${isNestedKit ? "cursor-pointer" : ""}`}
              onClick={isNestedKit ? () => toggleExpanded(`nested-${child.id}`) : undefined}
            >
              <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                <button type="button" onClick={() => onToggleVerify(child.id)} className="mx-auto block">
                  {isVerified
                    ? <CircleCheck className="h-4 w-4 text-green-500" />
                    : <Circle className="h-4 w-4 text-fg-3/30 hover:text-fg-3 transition-colors" />
                  }
                </button>
              </TableCell>
              <TableCell className="pl-12 text-sm text-fg-3">
                <div className="flex items-center gap-1.5">
                  {isNestedKit && (
                    <ChevronRight className={`h-3.5 w-3.5 text-fg-3 transition-transform ${nestedExpanded ? "rotate-90" : ""}`} />
                  )}
                  {isNestedKit && <Container className="h-3.5 w-3.5 text-fg-3" />}
                  <span>{child.model?.name || child.description || "Item"}</span>
                  {isNestedKit && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Kit</Badge>
                  )}
                  {nestedKitPartial && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-amber-500/10 text-amber-500 border-amber-500/20">Partial</Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="font-mono text-sm text-fg-3">
                {child.asset?.assetTag || child.bulkAsset?.assetTag || (isNestedKit ? (child.kit?.assetTag || "—") : "—")}
              </TableCell>
              <TableCell className="text-center">{isNestedKit ? filteredGrandchildren.length : child.quantity}</TableCell>
              <TableCell>
                {isVerified
                  ? <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">Verified</Badge>
                  : nestedKitPartial
                    ? <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20">Partial</Badge>
                    : <PrepStatusBadge item={child} />
                }
              </TableCell>
            </TableRow>
            {isNestedKit && nestedExpanded && filteredGrandchildren.map((nested) => {
              const nestedVerified = verifiedKitItems.has(nested.id);
              return (
                <TableRow key={nested.id} className={nestedVerified ? "bg-green-500/5" : "bg-bg-inset/20"}>
                  <TableCell className="text-center">
                    <button type="button" onClick={() => onToggleVerify(nested.id)} className="mx-auto block">
                      {nestedVerified
                        ? <CircleCheck className="h-4 w-4 text-green-500" />
                        : <Circle className="h-4 w-4 text-fg-3/30 hover:text-fg-3 transition-colors" />
                      }
                    </button>
                  </TableCell>
                  <TableCell className="pl-20 text-sm text-fg-3">
                    {nested.model?.name || nested.description || "Item"}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-fg-3">
                    {nested.asset?.assetTag || nested.bulkAsset?.assetTag || "—"}
                  </TableCell>
                  <TableCell className="text-center">{nested.quantity}</TableCell>
                  <TableCell>
                    {nestedVerified
                      ? <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">Verified</Badge>
                      : <PrepStatusBadge item={nested} />
                    }
                  </TableCell>
                </TableRow>
              );
            })}
          </Fragment>
        );
      })}
    </>
  );
}
