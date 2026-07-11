"use client";

import { CircleCheck } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, focusRing } from "@/lib/utils";
import { unitFulfillmentBadge } from "./equipment-row-descriptors";
import { useReassign } from "./reassign-context";
import { UnitHistoryPopover } from "./unit-history-popover";

/**
 * Compact "assets on this line" indicator. Instead of bloating the equipment
 * table with inline tags + per-unit rows, a muted tick-circle appears on any
 * line that has assigned serials (own-stock OR bulk). Hover shows the serials
 * (read-only, with fulfillment status); click opens a small panel to reassign a
 * unit to another same-model line or view its movement history. Renders nothing
 * when the line has no tagged units — so the table stays calm.
 */

interface IndicatorUnit {
  id: string;
  status?: string | null;
  returnCondition?: string | null;
  asset?: { id: string; assetTag: string } | null;
  bulkAsset?: { id: string; assetTag: string } | null;
}

interface Entry {
  unitId: string;
  tag: string;
  status: string | null;
  returnCondition: string | null;
  /** Serialised asset id — enables history + reassign (bulk/line-level lack one). */
  assetId: string | null;
  serialised: boolean;
}

export function LineAssetsIndicator({
  units,
  lineAssetTag,
  lineItemId,
  modelId,
}: {
  units?: IndicatorUnit[];
  /** Fallback for single-asset legacy lines that carry the tag on the line itself. */
  lineAssetTag?: string | null;
  lineItemId: string;
  modelId?: string | null;
}) {
  const reassignCtx = useReassign();

  const entries: Entry[] = (units ?? [])
    .map((u): Entry | null => {
      const tag = u.asset?.assetTag ?? u.bulkAsset?.assetTag ?? null;
      if (!tag) return null;
      return {
        unitId: u.id,
        tag,
        status: u.status ?? null,
        returnCondition: u.returnCondition ?? null,
        assetId: u.asset?.id ?? null,
        serialised: !!u.asset,
      };
    })
    .filter((e): e is Entry => e !== null);

  if (entries.length === 0 && lineAssetTag) {
    entries.push({ unitId: "", tag: lineAssetTag, status: null, returnCondition: null, assetId: null, serialised: false });
  }
  if (entries.length === 0) return null;

  const targets = reassignCtx
    ? (reassignCtx.targetsByModel.get(modelId ?? "") ?? []).filter((t) => t.id !== lineItemId)
    : [];

  return (
    <Popover>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`${entries.length} asset${entries.length !== 1 ? "s" : ""} assigned`}
                className={cn(
                  "shrink-0 inline-flex items-center gap-0.5 rounded-sm text-muted transition-colors hover:text-ink",
                  focusRing,
                )}
              >
                <CircleCheck className="h-3.5 w-3.5" />
                {entries.length > 1 && (
                  <span className="text-[10px] tabular-nums leading-none">{entries.length}</span>
                )}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent className="max-w-[240px]">
            <ul className="space-y-0.5">
              {entries.map((e, i) => (
                <li key={i} className="flex items-center gap-1.5 text-[11px]">
                  <span className="t-mono">{e.tag}</span>
                  {e.status && (
                    <span className="text-muted">· {unitFulfillmentBadge(e.status, e.returnCondition).label}</span>
                  )}
                </li>
              ))}
            </ul>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent align="start" className="w-72 max-h-80 overflow-y-auto p-0">
        <div className="border-b border-line px-3 py-2">
          <p className="text-caption font-medium text-ink">
            Assets on this line{entries.length > 1 ? ` (${entries.length})` : ""}
          </p>
        </div>
        <div className="space-y-0.5 p-1.5">
          {entries.map((e, i) => {
            const badge = unitFulfillmentBadge(e.status, e.returnCondition);
            const canReassign =
              !!reassignCtx &&
              e.serialised &&
              !!e.unitId &&
              e.status !== "RETURNED" &&
              e.status !== "CANCELLED" &&
              targets.length > 0;
            return (
              <div key={i} className="flex items-center justify-between gap-2 rounded-sm px-1.5 py-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="t-mono text-caption text-ink">{e.tag}</span>
                  {e.status && (
                    <Badge status={badge.status} className={cn("px-1.5 py-0 text-[10px]", badge.className)}>
                      {badge.label}
                    </Badge>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {e.assetId && <UnitHistoryPopover assetId={e.assetId} assetTag={e.tag} />}
                  {canReassign && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={reassignCtx!.pendingUnitId === e.unitId}
                          className="h-7 px-2 text-caption text-muted hover:text-ink"
                        >
                          {reassignCtx!.pendingUnitId === e.unitId ? "Moving…" : "Move"}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
                        <DropdownMenuGroup>
                          <DropdownMenuLabel>Move {e.tag} to…</DropdownMenuLabel>
                          {targets.map((t) => (
                            <DropdownMenuItem
                              key={t.id}
                              disabled={t.full}
                              onClick={() => reassignCtx!.reassign(e.unitId, t.id)}
                            >
                              {t.label}
                              {t.full ? " · full" : ""}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
