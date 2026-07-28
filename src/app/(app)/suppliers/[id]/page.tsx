"use client";
// use-client: live Convex data via client subscription (useQuery) (R-8.1.1)

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { PageMeta } from "@/components/layout/page-meta";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import { useSupplierOrdersBySupplier } from "@/hooks/use-supplier-orders";
import { Pencil, Mail, Phone, Globe, Trash2, Plus, ChevronRight, MoreHorizontal } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { AddressDisplay } from "@/components/ui/address-display";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useSupplierWrites } from "@/hooks/use-supplier-writes";
import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { assetStatusLabels, supplierOrderStatusLabels, supplierOrderTypeLabels, formatLabel } from "@/lib/status-labels";
import { formatCurrency } from "@/lib/formatters";
import { useActiveOrganization } from "@/lib/auth-client";
import { CanDo } from "@/components/auth/permission-gate";
import { EntityCommentsButton } from "@/components/collaboration/entity-comments-button";
import { RequirePermission } from "@/components/auth/require-permission";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { FadeIn } from "@/components/ui/motion";
import { DetailLayout, DetailMain, DetailSidebar, SidebarSection } from "@/components/layout/page-layouts";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, focusRing } from "@/lib/utils";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MobileCardList, type ColumnDef } from "@/components/ui/data-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";



// Order statuses that mean "money is still in motion" — open/live with this
// supplier. Used for the at-a-glance "open orders" figure.
const OPEN_ORDER_STATUSES = new Set(["DRAFT", "ORDERED", "PARTIAL"]);


export default function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <RequirePermission resource="supplier" action="read">
      <SupplierDetailContent params={params} />
    </RequirePermission>
  );
}

function SupplierDetailContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const supplierWrites = useSupplierWrites();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: supplier, isLoading } = useServerQuery({
    queryKey: ["supplier", orgId, id],
    enabled: !!orgId && isAuthenticated,
    queryFn: () => convex.query(api.suppliers.detail, { orgId: orgId!, id }),
  });

  // Live Convex subscription scoped to (org, supplier) — replaces a one-shot
  // fetch + a separate whole-org fingerprint subscription used only to detect
  // changes; this query IS the reactive data (R-8.3.3).
  const ordersData = useSupplierOrdersBySupplier(orgId, id);

  const { data: assetsData } = useServerQuery({
    queryKey: ["supplier-assets", orgId, id],
    queryFn: () => convex.query(api.suppliers.assetsPage, { orgId: orgId as string, supplierId: id, page: 1, pageSize: 50 }),
    enabled: !!supplier && !!orgId && isAuthenticated,
  });

  const { data: subhiresData } = useServerQuery({
    queryKey: ["supplier-subhires", orgId, id],
    queryFn: () => convex.query(api.suppliers.subhiresPage, { orgId: orgId as string, supplierId: id, page: 1, pageSize: 50 }),
    enabled: !!supplier && !!orgId && isAuthenticated,
  });

  const deleteMutation = useServerMutation({
    mutationFn: () => supplierWrites.remove(id),
    onSuccess: () => {
      toast.success("Supplier deleted");
      router.push("/suppliers");
    },
    onError: (e) => toast.error(e.message),
  });

  const [deleteOpen, setDeleteOpen] = useState(false);

  const orders = useMemo(() => ordersData?.orders || [], [ordersData]);
  const assets = assetsData?.assets || [];
  // WS7 #946 — the Subhires tab now lists sub-hire HEADS (order #, status,
  // cost/charge/margin, linked PO), replacing the old projectLineItems-based read
  // that couldn't show any of that (see FEATUREDOCS/22/39 — a visible behaviour change).
  const subhires = subhiresData?.subHires || [];

  // At-a-glance strip — total/open orders count come straight off the orders this
  // page already loads; spend is the server-computed DE-DUPLICATED rollup
  // (suppliers.detail's `spend`) — a linked sub-hire+order pair counts once, not
  // twice (see convex/suppliers.ts's computeSupplierSpend).
  const atAGlance = useMemo(() => {
    const totalOrders = supplier?._count?.orders ?? orders.length;
    const openOrders = supplier?.spend?.openOrderCount ?? orders.filter((o) => OPEN_ORDER_STATUSES.has(o.status)).length;
    const spend = supplier?.spend?.totalSpend ?? 0;
    return { totalOrders, openOrders, spend };
  }, [orders, supplier]);

  if (isLoading) return <DetailPageSkeleton />;
  if (!supplier) {
    return (
      <div className="mx-auto max-w-3xl rounded-[var(--r-lg)] border border-line border-l-2 border-l-t-out bg-card p-6 text-center">
        <p className="text-ui-text text-ink-2">Supplier not found.</p>
        <p className="mt-1 text-caption text-muted">It may have been deleted, or you don&apos;t have access to it.</p>
        <Button variant="line" size="sm" className="mt-4" asChild>
          <Link href="/suppliers">Back to suppliers</Link>
        </Button>
      </div>
    );
  }

  const contactBits = [supplier.contactName, supplier.email, supplier.phone].filter(Boolean);

  // Mobile card layouts for the sub-tables (rendered below `md`).
  const orderColumns: ColumnDef<(typeof orders)[number]>[] = [
    {
      id: "orderNumber",
      header: "Order #",
      mobile: "title",
      cell: (order) => (
        <Link href={`/suppliers/${id}/orders/${order.id}`} className={cn("rounded-sm t-mono font-medium text-ink hover:underline", focusRing)}>
          {order.orderNumber}
        </Link>
      ),
    },
    {
      id: "status",
      header: "Status",
      mobile: "badge",
      cell: (order) => (
        <StatusIndicator
          category="supplierOrder"
          value={order.status}
          label={supplierOrderStatusLabels[order.status] || formatLabel(order.status)}
        />
      ),
    },
    {
      id: "type",
      header: "Type",
      mobile: "meta",
      cell: (order) => <Badge status="neutral">{supplierOrderTypeLabels[order.type] || order.type}</Badge>,
    },
    {
      id: "project",
      header: "Project",
      mobile: "meta",
      cell: (order) =>
        order.project ? (
          <Link href={`/projects/${order.project.id}`} className={cn("rounded-sm text-ui-text text-link hover:underline", focusRing)}>
            {order.project.projectNumber}
          </Link>
        ) : (
          "—"
        ),
    },
    {
      id: "items",
      header: "Items",
      mobile: "meta",
      cell: (order) => <span className="t-data">{order._count?.items ?? 0}</span>,
    },
    {
      id: "total",
      header: "Total",
      mobile: "meta",
      cell: (order) => <span className="t-data">{order.total != null ? formatCurrency(Number(order.total)) : "—"}</span>,
    },
    {
      id: "date",
      header: "Date",
      mobile: "meta",
      cell: (order) => (order.orderDate ? new Date(order.orderDate).toLocaleDateString() : "—"),
    },
  ];

  const assetColumns: ColumnDef<(typeof assets)[number]>[] = [
    {
      id: "assetTag",
      header: "Asset tag",
      mobile: "title",
      cell: (asset) => (
        <Link href={`/assets/registry/${asset.id}`} className={cn("rounded-sm t-mono font-medium text-ink hover:underline", focusRing)}>
          {asset.assetTag}
        </Link>
      ),
    },
    {
      id: "model",
      header: "Model",
      mobile: "subtitle",
      cell: (asset) => asset.model?.name,
    },
    {
      id: "status",
      header: "Status",
      mobile: "badge",
      cell: (asset) => (
        <StatusIndicator
          category="asset"
          value={asset.status ?? ""}
          label={assetStatusLabels[asset.status ?? ""] || formatLabel(asset.status ?? "")}
          variant="pill"
        />
      ),
    },
    {
      id: "manufacturer",
      header: "Manufacturer",
      mobile: "meta",
      cell: (asset) => asset.model?.manufacturer || "—",
    },
    {
      id: "po",
      header: "PO #",
      mobile: "meta",
      cell: (asset) => <span className="t-mono">{asset.purchaseOrderNumber || "—"}</span>,
    },
  ];

  const subhireColumns: ColumnDef<(typeof subhires)[number]>[] = [
    {
      id: "orderNumber",
      header: "Order #",
      mobile: "title",
      cell: (sh) => <span className="t-mono font-medium text-ink">{sh.orderNumber}</span>,
    },
    {
      id: "status",
      header: "Status",
      mobile: "badge",
      cell: (sh) => (
        <StatusIndicator category="subHire" value={sh.status} label={formatLabel(sh.status)} variant="pill" />
      ),
    },
    {
      id: "project",
      header: "Project",
      mobile: "subtitle",
      cell: (sh) =>
        sh.project ? (
          <Link href={`/projects/${sh.project.id}`} className={cn("rounded-sm text-ui-text text-link hover:underline", focusRing)}>
            {sh.project.projectNumber}
          </Link>
        ) : "—",
    },
    {
      id: "cost",
      header: "Cost",
      mobile: "meta",
      cell: (sh) => <span className="t-data">{formatCurrency(sh.totalCost)}</span>,
    },
    {
      id: "charge",
      header: "Charge",
      mobile: "meta",
      cell: (sh) => <span className="t-data">{formatCurrency(sh.totalCharge)}</span>,
    },
    {
      id: "margin",
      header: "Margin",
      mobile: "meta",
      cell: (sh) => (
        <span className={cn("t-data", sh.margin > 0 ? "text-success" : sh.margin < 0 ? "text-destructive" : "")}>
          {sh.margin > 0 ? "+" : ""}{formatCurrency(sh.margin)}
        </span>
      ),
    },
    {
      id: "linkedOrder",
      header: "Linked PO",
      mobile: "meta",
      cell: (sh) =>
        sh.linkedOrder ? (
          <Link href={`/suppliers/${id}/orders/${sh.linkedOrder.id}`} className={cn("rounded-sm t-mono text-link hover:underline", focusRing)}>
            {sh.linkedOrder.orderNumber}
          </Link>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
  ];

  return (
    <>
      <PageMeta title={supplier.name} />
      <FadeIn>
        <div className="space-y-6">
          {/* ── Hero card (breadcrumb + identity + compact actions) ───── */}
          <div className="rounded-[var(--r-lg)] border-2 border-line bg-card p-4 shadow-[var(--sh-card)] space-y-4 sm:p-5">
            {/* Breadcrumb */}
            <nav className="flex items-center gap-1 text-caption text-muted">
              <Link href="/suppliers" className={cn("rounded-sm transition-colors hover:text-ink", focusRing)}>
                Suppliers
              </Link>
              <ChevronRight className="h-3 w-3" />
              <span className="truncate text-ink-2">{supplier.name}</span>
            </nav>

            {/* Identity + actions */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-page-title font-extrabold text-ink truncate">
                    {supplier.name}
                  </h1>
                  {supplier.isActive ? (
                    <Badge status="ok">Active</Badge>
                  ) : (
                    <Badge status="overbooked">Archived</Badge>
                  )}
                </div>
                {/* Contact meta line — only render bits that exist (no "—" noise) */}
                {contactBits.length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted">
                    {supplier.contactName && <span className="text-ink-2">{supplier.contactName}</span>}
                    {supplier.email && (
                      <a href={`mailto:${supplier.email}`} className={cn("inline-flex items-center gap-1 rounded-sm hover:text-ink", focusRing)}>
                        <Mail className="h-3.5 w-3.5" aria-hidden />
                        {supplier.email}
                      </a>
                    )}
                    {supplier.phone && (
                      <a href={`tel:${supplier.phone}`} className={cn("inline-flex items-center gap-1 rounded-sm hover:text-ink", focusRing)}>
                        <Phone className="h-3.5 w-3.5" aria-hidden />
                        {supplier.phone}
                      </a>
                    )}
                    {supplier.accountNumber && (
                      <span className="t-mono">Acct {supplier.accountNumber}</span>
                    )}
                  </div>
                )}
              </div>

              {/* Compact actions */}
              <div className="flex flex-wrap items-center gap-2">
                {orgId && (
                  <EntityCommentsButton orgId={orgId} entityType="supplier" entityId={id} />
                )}
                <CanDo resource="supplier" action="update">
                  <Button variant="line" size="sm" asChild>
                    <Link href={`/suppliers/${id}/edit`}>
                      <Pencil className="h-4 w-4" />
                      <span className="hidden sm:inline">Edit</span>
                    </Link>
                  </Button>
                  <CanDo resource="supplier" action="delete">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="line" size="sm" aria-label="More actions">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => setDeleteOpen(true)}
                          disabled={deleteMutation.isPending}
                          className="text-red data-[highlighted]:bg-red data-[highlighted]:text-white"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete supplier
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </CanDo>
                </CanDo>
              </div>
            </div>

            {/* At-a-glance strip — single surface, vertical dividers */}
            <div className="grid grid-cols-1 divide-y divide-line rounded-[var(--r)] border border-line bg-paper-2 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <GlanceCell figure={atAGlance.totalOrders} label="Total orders" />
              <GlanceCell figure={atAGlance.openOrders} label="Open orders" />
              <GlanceCell figure={formatCurrency(atAGlance.spend)} label="Spend" />
            </div>
          </div>

          {/* ── 2-Column Layout ────────────────────────────────────── */}
          <DetailLayout>
            {/* Main content */}
            <DetailMain>
              {/* Tags */}
              {supplier.tags?.length > 0 && (
                <div className="mb-6 flex flex-wrap gap-1">
                  {supplier.tags.map((tag: string) => (
                    <Badge key={tag} status="neutral">{tag}</Badge>
                  ))}
                </div>
              )}

              {/* Notes */}
              {supplier.notes && (
                <div className="mb-6">
                  <p className="whitespace-pre-wrap text-ui-text text-muted">{supplier.notes}</p>
                </div>
              )}

              <Tabs defaultValue="orders">
                <TabsList>
                  <TabsTrigger value="orders">Orders ({orders.length})</TabsTrigger>
                  <TabsTrigger value="assets">Assets ({assets.length})</TabsTrigger>
                  <TabsTrigger value="subhires">Subhires ({subhires.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="orders" className="mt-4">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="t-heading text-ink">Purchase &amp; subhire orders</h3>
                    <CanDo resource="supplier" action="create">
                      <Button size="sm" asChild>
                        <Link href={`/suppliers/${id}/orders/new`}>
                          <Plus className="mr-2 h-4 w-4" />
                          New order
                        </Link>
                      </Button>
                    </CanDo>
                  </div>
                  {orders.length === 0 ? (
                    <EmptyState title="No orders yet" description="Purchase and subhire orders from this supplier will appear here." />
                  ) : (
                    <>
                    <div className="hidden rounded-[var(--r)] border border-line md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Order #</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="hidden md:table-cell">Project</TableHead>
                            <TableHead className="hidden md:table-cell">Items</TableHead>
                            <TableHead className="hidden text-right sm:table-cell">Total</TableHead>
                            <TableHead className="hidden md:table-cell">Date</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {orders.map((order) => (
                            <TableRow key={order.id}>
                              <TableCell>
                                <Link href={`/suppliers/${id}/orders/${order.id}`} className={cn("rounded-sm t-mono font-medium text-ink hover:underline", focusRing)}>
                                  {order.orderNumber}
                                </Link>
                              </TableCell>
                              <TableCell>
                                <Badge status="neutral">{supplierOrderTypeLabels[order.type] || order.type}</Badge>
                              </TableCell>
                              <TableCell>
                                <StatusIndicator category="supplierOrder" value={order.status} label={supplierOrderStatusLabels[order.status] || formatLabel(order.status)} />
                              </TableCell>
                              <TableCell className="hidden md:table-cell">
                                {order.project ? (
                                  <Link href={`/projects/${order.project.id}`} className={cn("rounded-sm text-ui-text text-link hover:underline", focusRing)}>
                                    {order.project.projectNumber}
                                  </Link>
                                ) : "—"}
                              </TableCell>
                              <TableCell className="hidden text-muted md:table-cell t-data">
                                {order._count?.items ?? 0}
                              </TableCell>
                              <TableCell className="hidden text-right sm:table-cell t-data">
                                {order.total != null ? formatCurrency(Number(order.total)) : "—"}
                              </TableCell>
                              <TableCell className="hidden text-muted md:table-cell">
                                {order.orderDate ? new Date(order.orderDate).toLocaleDateString() : "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <MobileCardList
                      className="md:hidden"
                      data={orders}
                      columns={orderColumns}
                      getRowId={(order) => order.id}
                    />
                    </>
                  )}
                </TabsContent>

                <TabsContent value="assets" className="mt-4">
                  <h3 className="t-heading mb-4 text-ink">Purchased assets</h3>
                  {assets.length === 0 ? (
                    <EmptyState title="No assets from this supplier" description="Assets purchased from this supplier will appear here." />
                  ) : (
                    <>
                    <div className="hidden rounded-[var(--r)] border border-line md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Asset tag</TableHead>
                            <TableHead>Model</TableHead>
                            <TableHead className="hidden md:table-cell">Manufacturer</TableHead>
                            <TableHead className="hidden md:table-cell">PO #</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {assets.map((asset) => (
                            <TableRow key={asset.id}>
                              <TableCell>
                                <Link href={`/assets/registry/${asset.id}`} className={cn("rounded-sm t-mono font-medium text-ink hover:underline", focusRing)}>
                                  {asset.assetTag}
                                </Link>
                              </TableCell>
                              <TableCell>{asset.model?.name}</TableCell>
                              <TableCell className="hidden text-muted md:table-cell">
                                {asset.model?.manufacturer || "—"}
                              </TableCell>
                              <TableCell className="hidden text-muted md:table-cell t-mono">
                                {asset.purchaseOrderNumber || "—"}
                              </TableCell>
                              <TableCell>
                                <StatusIndicator category="asset" value={asset.status ?? ""} label={assetStatusLabels[asset.status ?? ""] || formatLabel(asset.status ?? "")} variant="pill" />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <MobileCardList
                      className="md:hidden"
                      data={assets}
                      columns={assetColumns}
                      getRowId={(asset) => asset.id}
                    />
                    </>
                  )}
                </TabsContent>

                <TabsContent value="subhires" className="mt-4">
                  <h3 className="t-heading mb-4 text-ink">Subhire orders</h3>
                  {subhires.length === 0 ? (
                    <EmptyState title="No subhire orders" description="Sub-hire orders from this supplier will appear here." />
                  ) : (
                    <>
                    <div className="hidden rounded-[var(--r)] border border-line md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Order #</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="hidden md:table-cell">Project</TableHead>
                            <TableHead className="hidden text-right sm:table-cell">Cost</TableHead>
                            <TableHead className="hidden text-right sm:table-cell">Charge</TableHead>
                            <TableHead className="text-right">Margin</TableHead>
                            <TableHead className="hidden md:table-cell">Linked PO</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {subhires.map((sh) => (
                            <TableRow key={sh.id}>
                              <TableCell className="t-mono font-medium text-ink">{sh.orderNumber}</TableCell>
                              <TableCell>
                                <StatusIndicator category="subHire" value={sh.status} label={formatLabel(sh.status)} variant="pill" />
                              </TableCell>
                              <TableCell className="hidden md:table-cell">
                                {sh.project ? (
                                  <Link href={`/projects/${sh.project.id}`} className={cn("rounded-sm text-ui-text text-link hover:underline", focusRing)}>
                                    {sh.project.projectNumber}
                                  </Link>
                                ) : "—"}
                              </TableCell>
                              <TableCell className="hidden text-right sm:table-cell t-data">{formatCurrency(sh.totalCost)}</TableCell>
                              <TableCell className="hidden text-right sm:table-cell t-data">{formatCurrency(sh.totalCharge)}</TableCell>
                              <TableCell className={cn("text-right t-data", sh.margin > 0 ? "text-success" : sh.margin < 0 ? "text-destructive" : "")}>
                                {sh.margin > 0 ? "+" : ""}{formatCurrency(sh.margin)}
                              </TableCell>
                              <TableCell className="hidden md:table-cell">
                                {sh.linkedOrder ? (
                                  <Link href={`/suppliers/${id}/orders/${sh.linkedOrder.id}`} className={cn("rounded-sm t-mono text-link hover:underline", focusRing)}>
                                    {sh.linkedOrder.orderNumber}
                                  </Link>
                                ) : (
                                  <span className="text-muted">—</span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <MobileCardList
                      className="md:hidden"
                      data={subhires}
                      columns={subhireColumns}
                      getRowId={(sh) => sh.id}
                    />
                    </>
                  )}
                </TabsContent>
              </Tabs>
            </DetailMain>

            {/* ── Sidebar (lean: Contact · Address · Account · Activity) ─ */}
            <DetailSidebar>
              {/* Contact */}
              <SidebarSection title="Contact">
                <div className="space-y-2 text-ui-text">
                  {supplier.contactName && (
                    <p className="font-medium text-ink">{supplier.contactName}</p>
                  )}
                  {supplier.email && (
                    <div className="flex items-center gap-2 text-muted">
                      <Mail className="h-3.5 w-3.5 shrink-0" />
                      <a href={`mailto:${supplier.email}`} className={cn("truncate rounded-sm text-link hover:underline", focusRing)}>{supplier.email}</a>
                    </div>
                  )}
                  {supplier.phone && (
                    <div className="flex items-center gap-2 text-muted">
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      <a href={`tel:${supplier.phone}`} className={cn("rounded-sm text-link hover:underline", focusRing)}>{supplier.phone}</a>
                    </div>
                  )}
                  {supplier.website && (
                    <div className="flex items-center gap-2 text-muted">
                      <Globe className="h-3.5 w-3.5 shrink-0" />
                      <a href={supplier.website} target="_blank" rel="noopener noreferrer" className={cn("truncate rounded-sm text-link hover:underline", focusRing)}>{supplier.website}</a>
                    </div>
                  )}
                  {!supplier.contactName && !supplier.email && !supplier.phone && !supplier.website && (
                    <p className="text-muted">No contact details on file.</p>
                  )}
                </div>
              </SidebarSection>

              {/* Address */}
              {supplier.address && (
                <SidebarSection title="Address">
                  <div className="text-ui-text">
                    <AddressDisplay
                      address={supplier.address}
                      latitude={supplier.latitude}
                      longitude={supplier.longitude}
                      label={supplier.name}
                      compact
                    />
                  </div>
                </SidebarSection>
              )}

              {/* Account details — only when at least one value exists */}
              {(supplier.accountNumber || supplier.paymentTerms || supplier.defaultLeadTime) && (
                <SidebarSection title="Account details">
                  <div className="space-y-1.5 text-ui-text">
                    {supplier.accountNumber && (
                      <div className="flex justify-between gap-2">
                        <span className="text-muted shrink-0">Account #</span>
                        <span className="font-medium text-ink t-mono">{supplier.accountNumber}</span>
                      </div>
                    )}
                    {supplier.paymentTerms && (
                      <div className="flex justify-between gap-2">
                        <span className="text-muted shrink-0">Payment terms</span>
                        <span className="font-medium text-ink text-right">{supplier.paymentTerms}</span>
                      </div>
                    )}
                    {supplier.defaultLeadTime && (
                      <div className="flex justify-between gap-2">
                        <span className="text-muted shrink-0">Lead time</span>
                        <span className="font-medium text-ink text-right">{supplier.defaultLeadTime}</span>
                      </div>
                    )}
                  </div>
                </SidebarSection>
              )}

              {/* Spend breakdown (WS7 #946) — the de-duplicated total shown in the
                  hero strip, broken into its committed-order / sub-hire components
                  plus the quoted-vs-invoiced variance summary across linked pairs. */}
              {supplier.spend && (
                <SidebarSection title="Spend">
                  <div className="space-y-1.5 text-ui-text">
                    <div className="flex justify-between gap-2">
                      <span className="text-muted">Committed orders</span>
                      <span className="font-medium text-ink t-data">{formatCurrency(supplier.spend.committedOrderSpend)}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-muted">Sub-hires</span>
                      <span className="font-medium text-ink t-data">{formatCurrency(supplier.spend.subHireSpend)}</span>
                    </div>
                    <div className="flex justify-between gap-2 border-t border-line pt-1.5">
                      <span className="text-muted">Total (de-duplicated)</span>
                      <span className="font-semibold text-ink t-data">{formatCurrency(supplier.spend.totalSpend)}</span>
                    </div>
                    {supplier.spend.variance.linkedCount > 0 && (
                      <div className="flex justify-between gap-2">
                        <span className="text-muted">Variance ({supplier.spend.variance.linkedCount} linked)</span>
                        <span className={cn("font-medium t-data", supplier.spend.variance.total > 0 ? "text-destructive" : supplier.spend.variance.total < 0 ? "text-success" : "text-ink")}>
                          {supplier.spend.variance.total > 0 ? "+" : ""}{formatCurrency(supplier.spend.variance.total)}
                        </span>
                      </div>
                    )}
                  </div>
                </SidebarSection>
              )}

              {/* Activity — realtime feed */}
              <SidebarSection title="Activity" divider={false}>
                <ActivityTimeline entityType="supplier" entityId={id} />
              </SidebarSection>
            </DetailSidebar>
          </DetailLayout>
        </div>
      </FadeIn>
      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete supplier?"
        description="This permanently removes the supplier. Past orders and subhires that referenced this supplier are preserved but unlinked. This cannot be undone."
        confirmLabel="Delete supplier"
        onConfirm={() => {
          deleteMutation.mutate();
          setDeleteOpen(false);
        }}
        pending={deleteMutation.isPending}
      />
    </>
  );
}

/** At-a-glance metric cell for the hero strip — figure over a muted label. */
function GlanceCell({ figure, label }: { figure: React.ReactNode; label: React.ReactNode }) {
  return (
    <div className="px-3 py-2.5 first:pl-4 last:pr-4">
      <div className="font-display text-[18px] font-extrabold leading-none tracking-tight tabular-nums text-ink">
        {figure}
      </div>
      <div className="mt-1 text-caption text-muted">{label}</div>
    </div>
  );
}
