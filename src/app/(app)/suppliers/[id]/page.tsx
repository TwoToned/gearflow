"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PageMeta } from "@/components/layout/page-meta";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import { useSupplierOrders, fingerprintSupplierOrders } from "@/hooks/use-back-office";
import { Pencil, Mail, Phone, Globe, MapPin, Trash2, Plus, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { AddressDisplay } from "@/components/ui/address-display";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { getSupplierById, getSupplierAssets, getSupplierSubhires, deleteSupplier } from "@/server/suppliers";
import { assetStatusLabels, supplierOrderStatusLabels, projectStatusLabels, formatLabel } from "@/lib/status-labels";
import { formatCurrency } from "@/lib/formatters";
import { getSupplierOrders } from "@/server/supplier-orders";
import { useActiveOrganization } from "@/lib/auth-client";
import { CanDo } from "@/components/auth/permission-gate";
import { PresenceAvatarStack } from "@/components/collaboration/presence-avatar-stack";
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
import { cn, focusRing } from "@/lib/utils";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";


const orderTypeLabels: Record<string, string> = {
  PURCHASE: "Purchase",
  SUBHIRE: "Subhire",
  REPAIR: "Repair",
  LABOUR: "Labour",
  OTHER: "Other",
};


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
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: supplier, isLoading } = useServerQuery({
    queryKey: ["supplier", orgId, id],
    queryFn: () => getSupplierById(id),
  });

  const { data: ordersData, refetch: refetchOrders } = useServerQuery({
    queryKey: ["supplier-orders", orgId, id],
    queryFn: () => getSupplierOrders({ supplierId: id, pageSize: 50 }),
    enabled: !!supplier,
  });

  // Cross-tab live sync: subscribe to the dual-written Convex supplierOrders
  // table; a fingerprint change (order placed/edited/received in another tab)
  // re-fetches this supplier's orders.
  const supplierOrderDocs = useSupplierOrders(orgId);
  const supplierOrderFp = fingerprintSupplierOrders(supplierOrderDocs);
  const prevSupplierOrderFp = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (supplierOrderFp !== undefined && prevSupplierOrderFp.current !== undefined && supplierOrderFp !== prevSupplierOrderFp.current) {
      refetchOrders();
    }
    if (supplierOrderFp !== undefined) prevSupplierOrderFp.current = supplierOrderFp;
  }, [supplierOrderFp, refetchOrders]);

  const { data: assetsData } = useServerQuery({
    queryKey: ["supplier-assets", orgId, id],
    queryFn: () => getSupplierAssets(id, { pageSize: 50 }),
    enabled: !!supplier,
  });

  const { data: subhiresData } = useServerQuery({
    queryKey: ["supplier-subhires", orgId, id],
    queryFn: () => getSupplierSubhires(id, { pageSize: 50 }),
    enabled: !!supplier,
  });

  const deleteMutation = useServerMutation({
    mutationFn: () => deleteSupplier(id),
    onSuccess: () => {
      toast.success("Supplier deleted");
      router.push("/suppliers");
    },
    onError: (e) => toast.error(e.message),
  });

  const [deleteOpen, setDeleteOpen] = useState(false);

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

  const orders = ordersData?.orders || [];
  const assets = assetsData?.assets || [];
  const subhires = subhiresData?.lineItems || [];

  return (
    <>
      <PageMeta title={supplier.name} />
      <FadeIn>
        <div className="space-y-6">
          {/* ── Header (full width) ────────────────────────────────── */}
          <div>
            {/* Breadcrumb */}
            <nav className="mb-2 flex items-center gap-1 t-small text-muted">
              <Link href="/suppliers" className={cn("rounded-sm transition-colors hover:text-ink", focusRing)}>
                Suppliers
              </Link>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="truncate font-medium text-ink">{supplier.name}</span>
            </nav>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="t-title text-ink">{supplier.name}</h1>
                  {!supplier.isActive && <Badge status="overbooked">Archived</Badge>}
                </div>
                <p className="t-body text-muted">
                  {supplier.contactName || "No primary contact"}
                  {supplier.accountNumber && <> &middot; Acct: {supplier.accountNumber}</>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {orgId && (
                  <PresenceAvatarStack entityType="supplier" entityId={id} size="sm" />
                )}
                {orgId && (
                  <EntityCommentsButton orgId={orgId} entityType="supplier" entityId={id} />
                )}
                <CanDo resource="supplier" action="update">
                  <div className="flex gap-2">
                    <Button variant="line" asChild>
                      <Link href={`/suppliers/${id}/edit`}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit
                      </Link>
                    </Button>
                    <CanDo resource="supplier" action="delete">
                      <Button
                        variant="line"
                        className="text-t-out hover:border-red hover:bg-red hover:text-white"
                        onClick={() => setDeleteOpen(true)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </Button>
                    </CanDo>
                  </div>
                </CanDo>
              </div>
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
                    <h3 className="t-heading text-ink">Purchase orders</h3>
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
                    <div className="rounded-[var(--r)] border border-line">
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
                                <span className="t-mono font-medium text-ink">{order.orderNumber}</span>
                              </TableCell>
                              <TableCell>
                                <Badge status="neutral">{orderTypeLabels[order.type] || order.type}</Badge>
                              </TableCell>
                              <TableCell>
                                <StatusIndicator category="supplierOrder" value={order.status} label={supplierOrderStatusLabels[order.status] || formatLabel(order.status)} />
                              </TableCell>
                              <TableCell className="hidden md:table-cell">
                                {order.project ? (
                                  <Link href={`/projects/${order.project.id}`} className={cn("rounded-sm text-ui-text text-link hover:underline", focusRing)}>
                                    {order.project.projectNumber}
                                  </Link>
                                ) : "\u2014"}
                              </TableCell>
                              <TableCell className="hidden text-muted md:table-cell t-data">
                                {order._count?.items ?? 0}
                              </TableCell>
                              <TableCell className="hidden text-right sm:table-cell t-data">
                                {order.total != null ? formatCurrency(Number(order.total)) : "\u2014"}
                              </TableCell>
                              <TableCell className="hidden text-muted md:table-cell">
                                {order.orderDate ? new Date(order.orderDate).toLocaleDateString() : "\u2014"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="assets" className="mt-4">
                  <h3 className="t-heading mb-4 text-ink">Purchased assets</h3>
                  {assets.length === 0 ? (
                    <EmptyState title="No assets from this supplier" description="Assets purchased from this supplier will appear here." />
                  ) : (
                    <div className="rounded-[var(--r)] border border-line">
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
                                {asset.model?.manufacturer || "\u2014"}
                              </TableCell>
                              <TableCell className="hidden text-muted md:table-cell t-mono">
                                {asset.purchaseOrderNumber || "\u2014"}
                              </TableCell>
                              <TableCell>
                                <StatusIndicator category="asset" value={asset.status ?? ""} label={assetStatusLabels[asset.status ?? ""] || formatLabel(asset.status ?? "")} variant="pill" />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="subhires" className="mt-4">
                  <h3 className="t-heading mb-4 text-ink">Subhire line items</h3>
                  {subhires.length === 0 ? (
                    <EmptyState title="No subhire items" description="Subhire line items from this supplier will appear here." />
                  ) : (
                    <div className="rounded-[var(--r)] border border-line">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Project</TableHead>
                            <TableHead>Model</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="hidden md:table-cell">Order #</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {subhires.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell>
                                <Link href={`/projects/${item.project?.id}`} className={cn("rounded-sm text-ui-text text-link hover:underline", focusRing)}>
                                  {item.project?.projectNumber} - {item.project?.name}
                                </Link>
                              </TableCell>
                              <TableCell>{item.model?.name || item.description}</TableCell>
                              <TableCell className="text-right t-data">{item.quantity}</TableCell>
                              <TableCell className="hidden text-muted md:table-cell t-mono">
                                {item.subhireOrderNumber || "\u2014"}
                              </TableCell>
                              <TableCell>
                                {item.project?.status ? (
                                  <StatusIndicator category="project" value={item.project.status} label={projectStatusLabels[item.project.status] || formatLabel(item.project.status)} variant="pill" />
                                ) : null}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </DetailMain>

            {/* ── Sidebar ──────────────────────────────────────────── */}
            <DetailSidebar>
                {/* Contact Info */}
                <SidebarSection title="Contact">
                  <div className="space-y-2 text-ui-text">
                    {supplier.contactName && (
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink">{supplier.contactName}</span>
                      </div>
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
                    {!supplier.contactName && !supplier.email && !supplier.phone && (
                      <p className="text-muted">No contact info</p>
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

                {/* Account Details */}
                <SidebarSection title="Account details">
                  <div className="space-y-1.5 text-ui-text">
                    <div className="flex justify-between">
                      <span className="text-muted">Account #</span>
                      <span className="font-medium text-ink">{supplier.accountNumber || "\u2014"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Payment terms</span>
                      <span className="font-medium text-ink">{supplier.paymentTerms || "\u2014"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Lead time</span>
                      <span className="font-medium text-ink">{supplier.defaultLeadTime || "\u2014"}</span>
                    </div>
                  </div>
                </SidebarSection>

                {/* Summary */}
                <SidebarSection title="Summary">
                  <div className="space-y-1.5 text-ui-text">
                    <div className="flex justify-between">
                      <span className="text-muted">Orders</span>
                      <span className="font-medium text-ink t-data">{supplier._count?.orders ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Assets</span>
                      <span className="font-medium text-ink t-data">{supplier._count?.assets ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Subhire items</span>
                      <span className="font-medium text-ink t-data">{supplier._count?.lineItems ?? 0}</span>
                    </div>
                  </div>
                </SidebarSection>

                {/* Recent Orders (compact) */}
                {orders.length > 0 && (
                  <SidebarSection title="Recent orders">
                    <div className="space-y-1">
                      {orders.slice(0, 5).map((order) => (
                        <div
                          key={order.id}
                          className="flex items-center justify-between py-1.5 text-ui-text"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="shrink-0 t-mono text-muted">
                              {order.orderNumber}
                            </span>
                            <Badge status="neutral">{orderTypeLabels[order.type] || order.type}</Badge>
                          </div>
                          <StatusIndicator
                            category="supplierOrder"
                            value={order.status}
                            label={supplierOrderStatusLabels[order.status] || formatLabel(order.status)}
                          />
                        </div>
                      ))}
                    </div>
                  </SidebarSection>
                )}

                {/* Activity Timeline */}
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
