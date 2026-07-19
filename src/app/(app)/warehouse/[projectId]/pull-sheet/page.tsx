"use client";
// use-client: interactive — event handlers (client-only) (R-8.1.1)

import React, { use } from "react";
import Link from "next/link";
import { useServerQuery } from "@/hooks/use-server-query";
import { ArrowLeft, Printer, Square, Container } from "lucide-react";

import { getProjectPullSheet } from "@/server/warehouse";
import { useActiveOrganization } from "@/lib/auth-client";
import { formatDate } from "@/lib/formatters";
import { RequirePermission } from "@/components/auth/require-permission";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusIndicator } from "@/components/ui/status-indicator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StickyTable } from "@/components/ui/sticky-table";

const statusLabels: Record<string, string> = {
  CONFIRMED: "Confirmed",
  PREPPING: "Prepping",
  CHECKED_OUT: "Deployed",
  ON_SITE: "On site",
  RETURNED: "Returned",
};

function PullSheetOverbookedBadge({ info }: { info?: { overBy: number; totalStock: number; effectiveStock?: number; totalBooked: number; inherited?: boolean; unavailableAssets?: number; reducedOnly?: boolean; hasOverbookedChildren?: boolean; hasReducedChildren?: boolean } | null }) {
  if (!info) return null;
  // NOTE (RVLT polish §5 print exception): the `print:*-red-*` / `print:*-blue-*`
  // literals below are deliberately NOT swapped to theme tokens. The app default
  // theme is dark espresso and there is no @media-print theme override, so
  // print:text-t-out / print:border-line would resolve to the *active* theme's
  // values — pale coral / near-invisible cream lines on white paper. The literal
  // mid-red/-blue print colours are theme-independent and chosen for B/W print
  // fidelity on the physical pull sheet. Leave as-is.
  const effective = info.effectiveStock ?? info.totalStock;
  const unavail = info.unavailableAssets || 0;

  // Kit parents with BOTH overbooked and reduced children show two badges
  if (info.inherited && info.hasOverbookedChildren && info.hasReducedChildren) {
    return (
      <>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge status="overbooked" className="ml-1.5 cursor-help print:border print:border-red-500 print:text-red-600">
                Overbooked
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Contains items that are over capacity</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge status="neutral" className="ml-1.5 cursor-help bg-blue-soft text-blue print:border print:border-blue-500 print:text-blue-600">
                Reduced stock
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Contains items with {unavail} asset{unavail !== 1 ? "s" : ""} in maintenance or lost</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </>
    );
  }

  const isReduced = info.reducedOnly;
  // Screen colour: reduced stock = info (blue), inherited-overbooked = warning
  // (amber), direct overbooked = problem (t-out). Print keeps a red outline.
  const screenClass = isReduced
    ? "bg-blue-soft text-blue"
    : info.inherited
      ? "bg-warn-soft text-warn"
      : "bg-out-soft text-t-out";
  const label = isReduced ? "Reduced stock" : "Overbooked";

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
        <TooltipTrigger asChild>
          <Badge
            status={isReduced ? "neutral" : info.inherited ? "warn" : "overbooked"}
            className={`ml-1.5 cursor-help print:border print:border-red-500 print:text-red-600 ${screenClass}`}
          >
            {label}
          </Badge>
        </TooltipTrigger>
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
    return (
      <RequirePermission resource="warehouse" action="read">
        <div className="space-y-6" aria-busy="true">
          <Skeleton className="h-10 w-64 rounded-[var(--r)]" />
          <Skeleton className="h-64 rounded-[var(--r-lg)]" />
        </div>
      </RequirePermission>
    );
  }

  if (!data) {
    return (
      <RequirePermission resource="warehouse" action="read">
        <div className="rounded-[var(--r)] border-l-[3px] border-l-t-out bg-card p-4 ring-1 ring-line">
          <p className="text-ui-text font-medium text-ink">Project not found</p>
          <p className="text-caption text-muted mt-0.5">
            It may have been removed, or you don&apos;t have access to it.
          </p>
          <Button variant="line" size="sm" className="mt-3" asChild>
            <Link href={`/warehouse/${projectId}`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to warehouse
            </Link>
          </Button>
        </div>
      </RequirePermission>
    );
  }

  const project = data.project;
  const groups = data.groups as Record<string, Array<Record<string, unknown>>>;

  const allGroups = Object.entries(groups).map(([name, items]) => ({
    name,
    items,
  }));

  return (
    <RequirePermission resource="warehouse" action="read">
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
          size="icon"
          asChild
        >
          <Link href={`/warehouse/${projectId}`} aria-label="Back to warehouse view">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <span className="text-ui-text text-muted">
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
        <h1 className="t-title text-ink print:text-xl">
          Pull sheet
        </h1>
        <div className="flex items-center gap-3 mt-1">
          <span className="t-mono text-muted">
            {project.projectNumber}
          </span>
          <StatusIndicator category="project" value={project.status} label={statusLabels[project.status] || project.status} variant="pill" />
        </div>
        <p className="text-section-header font-semibold text-ink mt-1">{project.name}</p>
        {project.client && (
          <p className="text-muted">{project.client.name}</p>
        )}
        <div className="flex gap-6 text-ui-text text-muted mt-2">
          <span>
            Rental: {formatDate(project.rentalStartDate as unknown as string | null)} –{" "}
            {formatDate(project.rentalEndDate as unknown as string | null)}
          </span>
          {project.loadInDate && (
            <span>Load in: {formatDate(project.loadInDate as unknown as string | null)}</span>
          )}
        </div>
      </div>

      {/* Equipment grouped */}
      {allGroups.length === 0 ? (
        <p className="text-muted text-center py-8">
          No equipment items on this project.
        </p>
      ) : (
        allGroups.map((group) => (
          <div key={group.name}>
            <h3 className="text-heading font-bold text-ink-2 mb-2 print:text-black">
              {group.name}
            </h3>
            <div className="rounded-[var(--r-lg)] border border-line print:border-black">
              {/* Screen: frozen checkbox + Item columns, the rest scroll sideways
                  (smart-wrapping, no overlap). Print: StickyTable resets to a normal
                  full-width table so the physical sheet is unchanged. */}
              <StickyTable
                frozenColWidths={[40, 180]}
                minTableWidth={600}
                colCountHint={5}
                frozenBg="var(--paper)"
              >
                <table className="w-full caption-bottom text-[13.5px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 print:w-8" />
                    <TableHead className="w-[180px] min-w-[180px] print:w-auto">Item</TableHead>
                    <TableHead className="text-center w-16 whitespace-nowrap">Qty</TableHead>
                    <TableHead className="min-w-[120px] whitespace-nowrap">Asset tag</TableHead>
                    <TableHead className="min-w-[130px]">Location</TableHead>
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

                    return (
                      <TableBody key={item.id as string} className="print:[break-inside:avoid]">
                        {/* Kit-parent tint is print-only: on screen the frozen cells
                            paint a solid surface, so a row-wide tint would show a seam
                            between the frozen and scrolling halves. Print is unchanged. */}
                        <TableRow className={isGroupParent ? "print:bg-paper-2/40" : ""}>
                          <TableCell className="text-center">
                            {isGroupParent
                              ? <Container className="h-4 w-4 text-muted print:text-black" />
                              : <Square className="h-4 w-4 text-muted print:text-black" />}
                          </TableCell>
                          <TableCell className="min-w-[180px]">
                            <span className={isGroupParent ? "font-bold text-ink" : "font-medium text-ink"}>
                              {isGroupParent ? `[Kit] ${itemName}` : itemName}
                            </span>
                            {isSubhire && (
                              <Badge status="neutral" className="ml-1.5 bg-blue-soft text-blue print:bg-transparent print:text-blue-700 print:border print:border-blue-400">Subhire</Badge>
                            )}
                            {overbookedInfo && <PullSheetOverbookedBadge info={overbookedInfo} />}
                            {isSubhire && supplier && (
                              <p className="text-caption text-muted mt-0.5">via {supplier.name}</p>
                            )}
                          </TableCell>
                          <TableCell className="text-center tabular-nums whitespace-nowrap">
                            {isGroupParent ? children.length : qty}
                          </TableCell>
                          <TableCell className="t-mono text-muted whitespace-nowrap min-w-[120px]">
                            {isGroupParent ? (kit?.assetTag || "") : (assetTag || "")}
                          </TableCell>
                          <TableCell className="text-table-cell text-muted min-w-[130px]">
                            {asset?.location?.name || ""}
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
                                  <Square className="h-3.5 w-3.5 text-muted print:text-black" />
                                </TableCell>
                                <TableCell className="pl-8">
                                  <span className="text-table-cell text-muted">{childName}</span>
                                  {childOverbookedInfo && <PullSheetOverbookedBadge info={childOverbookedInfo} />}
                                </TableCell>
                                <TableCell className="text-center text-table-cell tabular-nums whitespace-nowrap">{childQty}</TableCell>
                                <TableCell className="t-mono text-muted whitespace-nowrap">
                                  {childAsset?.assetTag || childBulk?.assetTag || ""}
                                </TableCell>
                                <TableCell className="text-caption text-muted">
                                  {childAsset?.location?.name || ""}
                                </TableCell>
                              </TableRow>
                              {/* Quantity expansion for kit children with qty > 1 */}
                              {childQty > 1 && Array.from({ length: childQty }).map((_, i) => (
                                <TableRow key={`${child.id}-${i}`}>
                                  <TableCell className="text-center">
                                    <Square className="h-3 w-3 text-faint print:text-black" />
                                  </TableCell>
                                  <TableCell className="pl-12">
                                    <span className="text-caption text-muted">{childName} - {i + 1}</span>
                                  </TableCell>
                                  <TableCell />
                                  <TableCell />
                                  <TableCell />
                                </TableRow>
                              ))}
                            </React.Fragment>
                          );
                        })}
                        {/* Non-kit units */}
                        {!isKit && qty > 1 && Array.from({ length: qty }).map((_, i) => (
                          <TableRow key={`${item.id}-sub-${i}`}>
                            <TableCell className="text-center">
                              <Square className="h-3 w-3 text-faint print:text-black" />
                            </TableCell>
                            <TableCell className="pl-8">
                              <span className="text-caption text-muted">{itemName} - {i + 1}</span>
                            </TableCell>
                            <TableCell />
                            <TableCell />
                            <TableCell />
                          </TableRow>
                        ))}
                      </TableBody>
                    );
                  })}
                </table>
              </StickyTable>
            </div>
          </div>
        ))
      )}

      {/* Print footer */}
      <div className="hidden print:block text-caption text-muted border-t pt-2 mt-8">
        <p>
          Printed {new Date().toLocaleDateString("en-AU")} — {project.name} (
          {project.projectNumber})
        </p>
      </div>
    </div>
    </RequirePermission>
  );
}
