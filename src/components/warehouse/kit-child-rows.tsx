"use client";

import { Fragment, createContext, useContext } from "react";
import {
  ChevronRight,
  Container,
  CircleCheck,
  Circle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { focusRing } from "@/lib/utils";

import type { LineItem } from "./warehouse-types";
import { PrepStatusBadge } from "./prep-status-badge";
import { ScanVerifyCard, ScanGroupCard } from "./scan-card";
import { accessoryKey, accessoryUnitKey } from "./relocate-accessories";

/** Provided by the warehouse page, per tab, so every nested accessory row can be
 *  selected on its own (Deploy / Return / De-prep / Move to…) without threading
 *  the tab's selection through each render path. Null = rows aren't selectable. */
export const AccessorySelectionContext = createContext<{
  selected: ReadonlySet<string>;
  toggle: (key: string) => void;
} | null>(null);

/** Selection checkbox + per-unit expansion for a nested ACCESSORY row. */
function AccessorySelect({ child, expanded, onToggleExpand }: { child: LineItem; expanded: boolean; onToggleExpand: () => void }) {
  const sel = useContext(AccessorySelectionContext);
  if (!sel) return null;
  const name = child.model?.name || child.description || "accessory";
  const hasUnits = (child.units?.length ?? 0) > 1;
  return (
    <span className="mr-1 inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <Checkbox
        checked={sel.selected.has(accessoryKey(child.id))}
        onCheckedChange={() => sel.toggle(accessoryKey(child.id))}
        aria-label={`Select ${name}`}
      />
      {hasUnits && (
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-label={expanded ? `Hide ${name} units` : `Show ${name} units`}
          className={`inline-flex h-6 w-6 items-center justify-center rounded-[var(--r)] ${focusRing}`}
        >
          <ChevronRight className={`h-3.5 w-3.5 text-muted transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>
      )}
    </span>
  );
}

/** One selectable row per unit of an expanded nested accessory. */
function AccessoryUnitRows({ child }: { child: LineItem }) {
  const sel = useContext(AccessorySelectionContext);
  if (!sel) return null;
  return (
    <>
      {(child.units ?? []).map((u, i) => (
        <TableRow key={u.id} className="bg-paper-2/30">
          <TableCell className="text-center">
            <Checkbox
              checked={sel.selected.has(accessoryUnitKey(u.id))}
              onCheckedChange={() => sel.toggle(accessoryUnitKey(u.id))}
              aria-label={`Select unit ${i + 1}`}
            />
          </TableCell>
          <TableCell className="pl-20 text-table-cell text-muted">Unit {i + 1}</TableCell>
          <TableCell className="t-mono text-muted">{u.asset?.assetTag ?? u.bulkAsset?.assetTag ?? "—"}</TableCell>
          <TableCell className="text-center tabular-nums">{u.quantity ?? 1}</TableCell>
          <TableCell />
        </TableRow>
      ))}
    </>
  );
}

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
              className={`${isVerified ? "bg-ok-soft/50" : "bg-paper-2/40"} ${isNestedKit ? `cursor-pointer ${focusRing}` : ""}`}
              onClick={isNestedKit ? () => toggleExpanded(`nested-${child.id}`) : undefined}
              role={isNestedKit ? "button" : undefined}
              tabIndex={isNestedKit ? 0 : undefined}
              aria-expanded={isNestedKit ? nestedExpanded : undefined}
              onKeyDown={isNestedKit ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleExpanded(`nested-${child.id}`);
                }
              } : undefined}
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
                  {child.childKind === "ACCESSORY" && (
                    <AccessorySelect
                      child={child}
                      expanded={expandedGroups.has(`acc-units-${child.id}`)}
                      onToggleExpand={() => toggleExpanded(`acc-units-${child.id}`)}
                    />
                  )}
                  <span>{child.model?.name || child.description || "Item"}</span>
                  {isNestedKit && (
                    <Badge status="neutral">Kit</Badge>
                  )}
                  {child.childKind === "ACCESSORY" && <Badge status="neutral">Accessory</Badge>}
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
            {child.childKind === "ACCESSORY" && expandedGroups.has(`acc-units-${child.id}`) && <AccessoryUnitRows child={child} />}
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

/**
 * Mobile (md:hidden) card-list rendering of kit children — same data, same
 * verify/expand handlers as `KitChildRows`, just stacked cards instead of table
 * rows (§15). Additive presentation only.
 */
export function MobileKitChildCards({
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

        const allGrandchildren = isNestedKit ? (child.childLineItems as LineItem[]) : [];
        const filteredGrandchildren = isNestedKit
          ? mode === "deploy"
            ? allGrandchildren.filter((gc) => gc.status !== "CHECKED_OUT" && gc.status !== "CANCELLED")
            : allGrandchildren.filter((gc) => gc.status === "CHECKED_OUT")
          : [];

        const nestedKitPartial = isNestedKit
          && allGrandchildren.some((gc) => gc.status === "CHECKED_OUT")
          && allGrandchildren.some((gc) => gc.status !== "CHECKED_OUT" && gc.status !== "CANCELLED");

        if (isNestedKit && filteredGrandchildren.length === 0) return null;

        if (isNestedKit) {
          return (
            <ScanGroupCard
              key={child.id}
              selected={false}
              onToggleSelect={() => {}}
              expanded={nestedExpanded}
              onToggleExpand={() => toggleExpanded(`nested-${child.id}`)}
              showKitGlyph
              name={child.model?.name || child.description || "Item"}
              badges={
                <>
                  <Badge status="neutral">Kit</Badge>
                  {nestedKitPartial && <Badge status="warn">Partial</Badge>}
                </>
              }
              assetTag={child.kit?.assetTag || "—"}
              qtyLabel={filteredGrandchildren.length}
              status={nestedKitPartial ? <Badge status="warn">Partial</Badge> : <PrepStatusBadge item={child} />}
            >
              {filteredGrandchildren.map((nested) => {
                const nestedVerified = verifiedKitItems.has(nested.id);
                return (
                  <ScanVerifyCard
                    key={nested.id}
                    verified={nestedVerified}
                    onToggleVerify={() => onToggleVerify(nested.id)}
                    name={nested.model?.name || nested.description || "Item"}
                    assetTag={nested.asset?.assetTag || nested.bulkAsset?.assetTag || "—"}
                    qtyLabel={nested.quantity}
                    status={<PrepStatusBadge item={nested} />}
                  />
                );
              })}
            </ScanGroupCard>
          );
        }

        return (
          <ScanVerifyCard
            key={child.id}
            verified={isVerified}
            onToggleVerify={() => onToggleVerify(child.id)}
            name={child.model?.name || child.description || "Item"}
            badges={child.childKind === "ACCESSORY" ? <Badge status="neutral">Accessory</Badge> : undefined}
            assetTag={child.asset?.assetTag || child.bulkAsset?.assetTag || "—"}
            qtyLabel={child.quantity}
            status={<PrepStatusBadge item={child} />}
          />
        );
      })}
    </>
  );
}

/** Toggle one id in a verified-set updater — shared by every accessory render. */
function toggledSet(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

interface BulkAccessoryProps {
  accessoryChildren?: LineItem[];
  mode: "deploy" | "return";
  verifiedKitItems: Set<string>;
  setVerifiedKitItems: (updater: (prev: Set<string>) => Set<string>) => void;
  expandedGroups: Set<string>;
  toggleExpanded: (key: string) => void;
}

/** Accessories of a quantity>1 accessory parent, rendered under its per-unit
 *  rows (the parent keeps per-unit selection; see `bulk-group`'s
 *  `accessoryChildren`). */
export function BulkAccessoryRows({ accessoryChildren, setVerifiedKitItems, ...rest }: BulkAccessoryProps) {
  if (!accessoryChildren || accessoryChildren.length === 0) return null;
  return (
    <KitChildRows
      kitChildren={accessoryChildren}
      onToggleVerify={(id) => setVerifiedKitItems((prev) => toggledSet(prev, id))}
      {...rest}
    />
  );
}

export function MobileBulkAccessoryCards({ accessoryChildren, setVerifiedKitItems, ...rest }: BulkAccessoryProps) {
  if (!accessoryChildren || accessoryChildren.length === 0) return null;
  return (
    <MobileKitChildCards
      kitChildren={accessoryChildren}
      onToggleVerify={(id) => setVerifiedKitItems((prev) => toggledSet(prev, id))}
      {...rest}
    />
  );
}
