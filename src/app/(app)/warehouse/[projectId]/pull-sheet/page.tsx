"use client";

import React, { use } from "react";
import Link from "next/link";
import { useServerQuery } from "@/hooks/use-server-query";
import { ArrowLeft, Printer, Square, Container } from "lucide-react";

import { getProjectPullSheet } from "@/server/warehouse";
import { getAccessoryChildren } from "@/components/warehouse/pick-list-progress";
import { useActiveOrganization } from "@/lib/auth-client";
import { formatDate } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/ui/status-indicator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const statusLabels: Record<string, string> = {
  CONFIRMED: "Confirmed",
  PREPPING: "Prepping",
  CHECKED_OUT: "Deployed",
  ON_SITE: "On Site",
  RETURNED: "Returned",
};

function PullSheetOverbookedBadge({ info }: { info?: { overBy: number; totalStock: number; effectiveStock?: number; totalBooked: number; inherited?: boolean; unavailableAssets?: number; reducedOnly?: boolean; hasOverbookedChildren?: boolean; hasReducedChildren?: boolean } | null }) {
  if (!info) return null;
  const effective = info.effectiveStock ?? info.totalStock;
  const unavail = info.unavailableAssets || 0;

  // Kit parents with BOTH overbooked and reduced children show two badges
  if (info.inherited && info.hasOverbookedChildren && info.hasReducedChildren) {
    return (
      <>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <Badge variant="outline" className="ml-1.5 cursor-help text-xs print:border-red-500 print:text-red-600 bg-red-500/10 text-red-600 border-red-500/20">
                  Overbooked
                </Badge>
              }
            />
            <TooltipContent>Contains items that are over capacity</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <Badge variant="outline" className="ml-1.5 cursor-help text-xs print:border-blue-500 print:text-blue-600 bg-blue-500/10 text-blue-600 border-blue-500/20">
                  Reduced Stock
                </Badge>
              }
            />
            <TooltipContent>Contains items with {unavail} asset{unavail !== 1 ? "s" : ""} in maintenance or lost</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </>
    );
  }

  const isReduced = info.reducedOnly;
  const colorClass = isReduced
    ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
    : info.inherited
      ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
      : "bg-red-500/10 text-red-600 border-red-500/20";
  const label = isReduced ? "Reduced Stock" : "Overbooked";

  function getTooltip() {
    if (info!.inherited) {
      return isReduced
        ? `Contains items with ${unavail} asset${unavail !== 1 ? "s" : ""} in maintenance or lost`
        : `Contains items that are ${info!.overBy} over capacity`;
    }
    if (isReduced) {
      return `${info!.overBy} over usable stock — ${unavail} of ${info!.totalStock} in maintenance or lost`;
    }
    return `${info!.overBy} over capacity (${info!.totalBooked} booked / ${effective} usable${unavail > 0 ? `, ${unavail} unavailable` : ""})`;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Badge
              variant="outline"
              className={`ml-1.5 cursor-help text-xs print:border-red-500 print:text-red-600 ${colorClass}`}
            >
              {label}
            </Badge>
          }
        />
        <TooltipContent>
          {getTooltip()}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function PullSheetPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data, isLoading } = useServerQuery({
    queryKey: ["warehouse-pullsheet", orgId, projectId],
    queryFn: () => getProjectPullSheet(projectId),
  });

  if (isLoading) {
    return <div className="text-fg-3">Loading...</div>;
  }

  if (!data) {
    return <div className="text-fg-3">Project not found.</div>;
  }

  const project = data.project;
  const groups = data.groups as Record<string, Array<Record<string, unknown>>>;

  const allGroups = Object.entries(groups).map(([name, items]) => ({
    name,
    items,
  }));

  return (
    <div className="space-y-6">
      {/* Print pagination: repeat the table header on every page, never split a
          row mid-cell, keep each item (its units + accessories) together, and
          keep a group heading with the rows that follow it. */}
      <style>{`
        @media print {
          @page { margin: 14mm; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; }
          h3 { break-after: avoid; }
          tbody { break-inside: avoid; }
        }
      `}</style>
      {/* Screen-only header with back button */}
      <div className="flex items-center gap-2 print:hidden">
        <Button
          variant="ghost"
          size="icon-sm"
          render={<Link href={`/warehouse/${projectId}`} />}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm text-fg-3">
          Back to warehouse view
        </span>
        <div className="ml-auto">
          <Button onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>
      </div>

      {/* Print header */}
      <div className="print:mb-6">
        <h1 className="t-title text-fg print:text-xl">
          Pull Sheet
        </h1>
        <div className="flex items-center gap-3 mt-1">
          <span className="font-mono text-sm text-fg-3">
            {project.projectNumber}
          </span>
          <StatusIndicator category="project" value={project.status} label={statusLabels[project.status] || project.status} variant="pill" />
        </div>
        <p className="text-lg font-semibold mt-1">{project.name}</p>
        {project.client && (
          <p className="text-fg-3">{project.client.name}</p>
        )}
        <div className="flex gap-6 text-sm text-fg-3 mt-2">
          <span>
            Rental: {formatDate(project.rentalStartDate as unknown as string | null)} –{" "}
            {formatDate(project.rentalEndDate as unknown as string | null)}
          </span>
          {project.loadInDate && (
            <span>Load In: {formatDate(project.loadInDate as unknown as string | null)}</span>
          )}
        </div>
      </div>

      {/* Equipment grouped */}
      {allGroups.length === 0 ? (
        <p className="text-fg-3 text-center py-8">
          No equipment items on this project.
        </p>
      ) : (
        allGroups.map((group) => (
          <div key={group.name}>
            <h3 className="text-sm font-semibold text-fg-3 mb-2 print:text-black">
              {group.name}
            </h3>
            <div className="rounded-md border print:border-black">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 print:w-8" />
                    <TableHead>Item</TableHead>
                    <TableHead className="text-center w-16">Qty</TableHead>
                    <TableHead>Asset Tag</TableHead>
                    <TableHead>Location</TableHead>
                  </TableRow>
                </TableHeader>
                {group.items.map((item) => {
                    const model = item.model as { name: string; modelNumber?: string | null } | null;
                    const asset = item.asset as { assetTag: string; location?: { name: string } | null } | null;
                    const bulkAsset = item.bulkAsset as { assetTag: string } | null;
                    const kit = item.kit as { assetTag: string; name: string } | null;
                    const assetTag = asset?.assetTag || bulkAsset?.assetTag || null;
                    const overbookedInfo = item.overbookedInfo as { overBy: number; totalStock: number; totalBooked: number; inherited?: boolean } | null;
                    const supplier = item.supplier as { name: string } | null;
                    const isSubhire = !!(item.subHireId != null);
                    const isKit = !!(item.kitId) && !(item.isKitChild);
                    const isGroupParent = isKit;
                    const children = isGroupParent ? ((item.childLineItems || []) as Array<Record<string, unknown>>) : [];
                    const qty = item.quantity as number;
                    const itemName = isGroupParent
                      ? (item.description as string) || kit?.name || "Kit"
                      : model
                        ? [model.name, model.modelNumber].filter(Boolean).join(" - ")
                        : (item.description as string) || "Unnamed item";

                    // Accessories: shown per-unit when the bulk quantity divides
                    // evenly across the units (e.g. 2 adaptors on a 2x line → 1
                    // under each unit). Serialised or non-divisible accessories
                    // fall back to one row under the line.
                    const accessories = isKit ? [] : getAccessoryChildren(item);
                    const perUnitAcc = qty > 1
                      ? accessories.filter((a) => a.bulkAssetId && (a.quantity as number) % qty === 0)
                      : [];
                    const lineAcc = accessories.filter((a) => !perUnitAcc.includes(a));

                    const accRow = (child: Record<string, unknown>, q: number, indent: string) => {
                      const cm = child.model as { name: string } | null;
                      const ca = child.asset as { assetTag: string; location?: { name: string } | null } | null;
                      const cb = child.bulkAsset as { assetTag: string } | null;
                      return (
                        <TableRow key={`${child.id}-acc`}>
                          <TableCell className="text-center">
                            <Square className="h-3.5 w-3.5 text-fg-3 print:text-black" />
                          </TableCell>
                          <TableCell className={indent}>
                            <span className="text-sm text-fg-3">{cm?.name || (child.description as string) || "-"}</span>
                            <Badge variant="outline" className="ml-1.5 text-[10px] px-1.5 py-0 print:bg-transparent print:border-fg-3">Accessory</Badge>
                          </TableCell>
                          <TableCell className="text-center text-sm">{q}</TableCell>
                          <TableCell className="font-mono text-xs text-fg-3">{ca?.assetTag || cb?.assetTag || "—"}</TableCell>
                          <TableCell className="text-xs text-fg-3">{ca?.location?.name || "—"}</TableCell>
                        </TableRow>
                      );
                    };

                    return (
                      <TableBody key={item.id as string} className="print:[break-inside:avoid]">
                        <TableRow className={isGroupParent ? "bg-bg-inset/30" : ""}>
                          <TableCell className="text-center">
                            {isGroupParent
                              ? <Container className="h-4 w-4 text-fg-3 print:text-black" />
                              : <Square className="h-4 w-4 text-fg-3 print:text-black" />}
                          </TableCell>
                          <TableCell>
                            <span className={isGroupParent ? "font-bold" : "font-medium"}>
                              {isGroupParent ? `[Kit] ${itemName}` : itemName}
                            </span>
                            {isSubhire && (
                              <Badge variant="outline" className="ml-1.5 text-[10px] px-1.5 py-0 bg-cyan-500/10 text-cyan-600 border-cyan-500/20 print:bg-transparent print:text-cyan-700 print:border-cyan-400">Subhire</Badge>
                            )}
                            {overbookedInfo && <PullSheetOverbookedBadge info={overbookedInfo} />}
                            {isSubhire && supplier && (
                              <p className="text-xs text-fg-3 mt-0.5">via {supplier.name}</p>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {isGroupParent ? children.length : qty}
                          </TableCell>
                          <TableCell className="font-mono text-sm text-fg-3">
                            {isGroupParent ? (kit?.assetTag || "—") : (assetTag || "—")}
                          </TableCell>
                          <TableCell className="text-sm text-fg-3">
                            {asset?.location?.name || "—"}
                          </TableCell>
                        </TableRow>
                        {/* Kit children */}
                        {children.map((child) => {
                          const childModel = child.model as { name: string; modelNumber?: string | null } | null;
                          const childAsset = child.asset as { assetTag: string; location?: { name: string } | null } | null;
                          const childBulk = child.bulkAsset as { assetTag: string } | null;
                          const childName = childModel?.name || (child.description as string) || "-";
                          const childQty = child.quantity as number;
                          const childOverbookedInfo = child.overbookedInfo as { overBy: number; totalStock: number; totalBooked: number; inherited?: boolean } | null;

                          return (
                            <React.Fragment key={child.id as string}>
                              <TableRow>
                                <TableCell className="text-center">
                                  <Square className="h-3.5 w-3.5 text-fg-3 print:text-black" />
                                </TableCell>
                                <TableCell className="pl-8">
                                  <span className="text-sm text-fg-3">{childName}</span>
                                  {childOverbookedInfo && <PullSheetOverbookedBadge info={childOverbookedInfo} />}
                                </TableCell>
                                <TableCell className="text-center text-sm">{childQty}</TableCell>
                                <TableCell className="font-mono text-xs text-fg-3">
                                  {childAsset?.assetTag || childBulk?.assetTag || "—"}
                                </TableCell>
                                <TableCell className="text-xs text-fg-3">
                                  {childAsset?.location?.name || "—"}
                                </TableCell>
                              </TableRow>
                              {/* Quantity expansion for kit children with qty > 1 */}
                              {childQty > 1 && Array.from({ length: childQty }).map((_, i) => (
                                <TableRow key={`${child.id}-${i}`}>
                                  <TableCell className="text-center">
                                    <Square className="h-3 w-3 text-fg-3/50 print:text-black" />
                                  </TableCell>
                                  <TableCell className="pl-12">
                                    <span className="text-xs text-fg-3">{childName} - {i + 1}</span>
                                  </TableCell>
                                  <TableCell />
                                  <TableCell />
                                  <TableCell />
                                </TableRow>
                              ))}
                            </React.Fragment>
                          );
                        })}
                        {/* Non-kit units, each with the accessories that unit needs */}
                        {!isKit && qty > 1 && Array.from({ length: qty }).map((_, i) => (
                          <React.Fragment key={`${item.id}-sub-${i}`}>
                            <TableRow>
                              <TableCell className="text-center">
                                <Square className="h-3 w-3 text-fg-3/50 print:text-black" />
                              </TableCell>
                              <TableCell className="pl-8">
                                <span className="text-xs text-fg-3">{itemName} - {i + 1}</span>
                              </TableCell>
                              <TableCell />
                              <TableCell />
                              <TableCell />
                            </TableRow>
                            {perUnitAcc.map((acc) => accRow(acc, (acc.quantity as number) / qty, "pl-12"))}
                          </React.Fragment>
                        ))}
                        {/* Line-level accessories: qty-1 lines, or serialised / non-divisible bulk */}
                        {!isKit && (qty > 1 ? lineAcc : accessories).map((acc) => accRow(acc, acc.quantity as number, "pl-8"))}
                      </TableBody>
                    );
                  })}
              </Table>
            </div>
          </div>
        ))
      )}

      {/* Print footer */}
      <div className="hidden print:block text-xs text-fg-3 border-t pt-2 mt-8">
        <p>
          Printed {new Date().toLocaleDateString("en-AU")} — {project.name} (
          {project.projectNumber})
        </p>
      </div>
    </div>
  );
}
