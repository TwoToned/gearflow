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
import { focusRing } from "@/lib/utils";

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
              className={`${isVerified ? "bg-ok-soft/50" : "bg-paper-2/40"} ${isNestedKit ? "cursor-pointer" : ""}`}
              onClick={isNestedKit ? () => toggleExpanded(`nested-${child.id}`) : undefined}
            >
              <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => onToggleVerify(child.id)}
                  aria-pressed={isVerified}
                  aria-label={isVerified ? "Verified — tap to clear" : "Tap to verify present"}
                  className={`mx-auto inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r)] ${focusRing}`}
                >
                  {isVerified
                    ? <CircleCheck className="h-4 w-4 text-ok" />
                    : <Circle className="h-4 w-4 text-faint hover:text-muted transition-colors" />
                  }
                </button>
              </TableCell>
              <TableCell className="pl-12 text-table-cell text-muted">
                <div className="flex items-center gap-1.5">
                  {isNestedKit && (
                    <ChevronRight className={`h-3.5 w-3.5 text-muted transition-transform ${nestedExpanded ? "rotate-90" : ""}`} />
                  )}
                  {isNestedKit && <Container className="h-3.5 w-3.5 text-muted" />}
                  <span>{child.model?.name || child.description || "Item"}</span>
                  {isNestedKit && (
                    <Badge status="neutral">Kit</Badge>
                  )}
                  {nestedKitPartial && (
                    <Badge status="warn">Partial</Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="t-mono text-muted">
                {child.asset?.assetTag || child.bulkAsset?.assetTag || (isNestedKit ? (child.kit?.assetTag || "—") : "—")}
              </TableCell>
              <TableCell className="text-center tabular-nums">{isNestedKit ? filteredGrandchildren.length : child.quantity}</TableCell>
              <TableCell>
                {isVerified
                  ? <Badge status="ok">Verified</Badge>
                  : nestedKitPartial
                    ? <Badge status="warn">Partial</Badge>
                    : <PrepStatusBadge item={child} />
                }
              </TableCell>
            </TableRow>
            {isNestedKit && nestedExpanded && filteredGrandchildren.map((nested) => {
              const nestedVerified = verifiedKitItems.has(nested.id);
              return (
                <TableRow key={nested.id} className={nestedVerified ? "bg-ok-soft/50" : "bg-paper-2/30"}>
                  <TableCell className="text-center">
                    <button
                      type="button"
                      onClick={() => onToggleVerify(nested.id)}
                      aria-pressed={nestedVerified}
                      aria-label={nestedVerified ? "Verified — tap to clear" : "Tap to verify present"}
                      className={`mx-auto inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r)] ${focusRing}`}
                    >
                      {nestedVerified
                        ? <CircleCheck className="h-4 w-4 text-ok" />
                        : <Circle className="h-4 w-4 text-faint hover:text-muted transition-colors" />
                      }
                    </button>
                  </TableCell>
                  <TableCell className="pl-20 text-table-cell text-muted">
                    {nested.model?.name || nested.description || "Item"}
                  </TableCell>
                  <TableCell className="t-mono text-muted">
                    {nested.asset?.assetTag || nested.bulkAsset?.assetTag || "—"}
                  </TableCell>
                  <TableCell className="text-center tabular-nums">{nested.quantity}</TableCell>
                  <TableCell>
                    {nestedVerified
                      ? <Badge status="ok">Verified</Badge>
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
