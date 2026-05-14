"use client";

import { use, useState } from "react";
import Link from "next/link";
import { PageMeta } from "@/components/layout/page-meta";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Mail, Phone, Globe, MapPin, Trash2, Plus, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { AddressDisplay } from "@/components/ui/address-display";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { getSupplierById, getSupplierAssets, getSupplierSubhires, deleteSupplier } from "@/server/suppliers";
import { assetStatusLabels, supplierOrderStatusLabels, projectStatusLabels, formatLabel } from "@/lib/status-labels";
import { getSupplierOrders } from "@/server/supplier-orders";
import { useActiveOrganization } from "@/lib/auth-client";
import { CanDo } from "@/components/auth/permission-gate";
import { RequirePermission } from "@/components/auth/require-permission";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { FadeIn } from "@/components/ui/motion";
import { SectionHeader } from "@/components/layout/page-layouts";
import { ActivityTimeline } from "@/components/activity/activity-timeline";

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
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: supplier, isLoading } = useQuery({
    queryKey: ["supplier", orgId, id],
    queryFn: () => getSupplierById(id),
  });

  const { data: ordersData } = useQuery({
    queryKey: ["supplier-orders", orgId, id],
    queryFn: () => getSupplierOrders({ supplierId: id, pageSize: 50 }),
    enabled: !!supplier,
  });

  const { data: assetsData } = useQuery({
    queryKey: ["supplier-assets", orgId, id],
    queryFn: () => getSupplierAssets(id, { pageSize: 50 }),
    enabled: !!supplier,
  });

  const { data: subhiresData } = useQuery({
    queryKey: ["supplier-subhires", orgId, id],
    queryFn: () => getSupplierSubhires(id, { pageSize: 50 }),
    enabled: !!supplier,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteSupplier(id),
    onSuccess: () => {
      toast.success("Supplier deleted");
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      router.push("/suppliers");
    },
    onError: (e) => toast.error(e.message),
  });

  const [deleteOpen, setDeleteOpen] = useState(false);

  if (isLoading) return <DetailPageSkeleton />;
  if (!supplier) return <div className="text-fg-3 py-12 text-center">Supplier not found.</div>;

  const orders = ordersData?.orders || [];
  const assets = assetsData?.assets || [];
  const subhires = subhiresData?.lineItems || [];

  return (
    <RequirePermission resource="supplier" action="read">
      <PageMeta title={supplier.name} />
      <FadeIn>
        <div className="space-y-6">
          {/* ── Header (full width) ────────────────────────────────── */}
          <div>
            {/* Breadcrumb */}
            <nav className="mb-2 flex items-center gap-1 text-sm text-fg-3">
              <Link href="/suppliers" className="hover:text-fg transition-colors">
                Suppliers
              </Link>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="text-fg font-medium truncate">{supplier.name}</span>
            </nav>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="t-title text-fg">{supplier.name}</h1>
                  {!supplier.isActive && <Badge variant="destructive">Archived</Badge>}
                </div>
                <p className="t-body text-fg-3">
                  {supplier.contactName || "No primary contact"}
                  {supplier.accountNumber && <> &middot; Acct: {supplier.accountNumber}</>}
                </p>
              </div>
              <CanDo resource="supplier" action="update">
                <div className="flex gap-2">
                  <Button variant="outline" render={<Link href={`/suppliers/${id}/edit`} />}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </Button>
                  <CanDo resource="supplier" action="delete">
                    <Button
                      variant="outline"
                      className="text-destructive"
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

          {/* ── 2-Column Layout ────────────────────────────────────── */}
          <div className="flex flex-col gap-6 lg:flex-row">
            {/* Main content */}
            <div className="min-w-0 flex-1">
              {/* Tags */}
              {supplier.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-6">
                  {supplier.tags.map((tag: string) => (
                    <Badge key={tag} variant="secondary">{tag}</Badge>
                  ))}
                </div>
              )}

              {/* Notes */}
              {supplier.notes && (
                <div className="mb-6">
                  <p className="text-sm whitespace-pre-wrap text-fg-3">{supplier.notes}</p>
                </div>
              )}

              <Tabs defaultValue="orders">
                <TabsList>
                  <TabsTrigger value="orders">Orders ({orders.length})</TabsTrigger>
                  <TabsTrigger value="assets">Assets ({assets.length})</TabsTrigger>
                  <TabsTrigger value="subhires">Subhires ({subhires.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="orders" className="mt-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="t-heading text-fg">Purchase Orders</h3>
                    <CanDo resource="supplier" action="create">
                      <Button size="sm" render={<Link href={`/suppliers/${id}/orders/new`} />}>
                        <Plus className="mr-2 h-4 w-4" />
                        New Order
                      </Button>
                    </CanDo>
                  </div>
                  {orders.length === 0 ? (
                    <EmptyState preset="suppliers" heading="No orders yet" description="Purchase and subhire orders from this supplier will appear here." />
                  ) : (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Order #</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="hidden md:table-cell">Project</TableHead>
                            <TableHead className="hidden md:table-cell">Items</TableHead>
                            <TableHead className="text-right hidden sm:table-cell">Total</TableHead>
                            <TableHead className="hidden md:table-cell">Date</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {orders.map((order) => (
                            <TableRow key={order.id}>
                              <TableCell>
                                <span className="font-mono text-sm font-medium">{order.orderNumber}</span>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">{orderTypeLabels[order.type] || order.type}</Badge>
                              </TableCell>
                              <TableCell>
                                <StatusIndicator category="supplierOrder" value={order.status} label={supplierOrderStatusLabels[order.status] || formatLabel(order.status)} />
                              </TableCell>
                              <TableCell className="hidden md:table-cell">
                                {order.project ? (
                                  <Link href={`/projects/${order.project.id}`} className="hover:underline text-sm">
                                    {order.project.projectNumber}
                                  </Link>
                                ) : "\u2014"}
                              </TableCell>
                              <TableCell className="hidden md:table-cell text-fg-3">
                                {order._count?.items ?? 0}
                              </TableCell>
                              <TableCell className="text-right hidden sm:table-cell t-data">
                                {order.total != null ? `$${Number(order.total).toFixed(2)}` : "\u2014"}
                              </TableCell>
                              <TableCell className="text-fg-3 hidden md:table-cell">
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
                  <h3 className="t-heading text-fg mb-4">Purchased Assets</h3>
                  {assets.length === 0 ? (
                    <EmptyState preset="assets" heading="No assets from this supplier" description="Assets purchased from this supplier will appear here." />
                  ) : (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Asset Tag</TableHead>
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
                                <Link href={`/assets/registry/${asset.id}`} className="font-mono text-sm font-medium hover:underline">
                                  {asset.assetTag}
                                </Link>
                              </TableCell>
                              <TableCell>{asset.model?.name}</TableCell>
                              <TableCell className="text-fg-3 hidden md:table-cell">
                                {asset.model?.manufacturer || "\u2014"}
                              </TableCell>
                              <TableCell className="text-fg-3 hidden md:table-cell font-mono text-sm">
                                {asset.purchaseOrderNumber || "\u2014"}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">{assetStatusLabels[asset.status] || formatLabel(asset.status)}</Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="subhires" className="mt-4">
                  <h3 className="t-heading text-fg mb-4">Subhire Line Items</h3>
                  {subhires.length === 0 ? (
                    <EmptyState preset="suppliers" heading="No subhire items" description="Subhire line items from this supplier will appear here." />
                  ) : (
                    <div className="rounded-md border">
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
                                <Link href={`/projects/${item.project?.id}`} className="hover:underline text-sm">
                                  {item.project?.projectNumber} - {item.project?.name}
                                </Link>
                              </TableCell>
                              <TableCell>{item.model?.name || item.description}</TableCell>
                              <TableCell className="text-right t-data">{item.quantity}</TableCell>
                              <TableCell className="text-fg-3 hidden md:table-cell font-mono text-sm">
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
            </div>

            {/* ── Sidebar ──────────────────────────────────────────── */}
            <div className="w-full space-y-4 lg:w-[340px] lg:shrink-0">
              <div className="lg:sticky lg:top-4 space-y-4">
                {/* Contact Info */}
                <div className="border-b border-border pb-4 space-y-2">
                  <SectionHeader label="Contact" />
                  <div className="space-y-2 text-sm">
                    {supplier.contactName && (
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{supplier.contactName}</span>
                      </div>
                    )}
                    {supplier.email && (
                      <div className="flex items-center gap-2 text-fg-3">
                        <Mail className="h-3.5 w-3.5 shrink-0" />
                        <a href={`mailto:${supplier.email}`} className="hover:underline truncate">{supplier.email}</a>
                      </div>
                    )}
                    {supplier.phone && (
                      <div className="flex items-center gap-2 text-fg-3">
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        <a href={`tel:${supplier.phone}`} className="hover:underline">{supplier.phone}</a>
                      </div>
                    )}
                    {supplier.website && (
                      <div className="flex items-center gap-2 text-fg-3">
                        <Globe className="h-3.5 w-3.5 shrink-0" />
                        <a href={supplier.website} target="_blank" rel="noopener noreferrer" className="hover:underline truncate">{supplier.website}</a>
                      </div>
                    )}
                    {!supplier.contactName && !supplier.email && !supplier.phone && (
                      <p className="text-fg-3">No contact info</p>
                    )}
                  </div>
                </div>

                {/* Address */}
                {supplier.address && (
                  <div className="border-b border-border pb-4 space-y-2">
                    <SectionHeader label="Address" />
                    <div className="text-sm">
                      <AddressDisplay
                        address={supplier.address}
                        latitude={supplier.latitude}
                        longitude={supplier.longitude}
                        label={supplier.name}
                        compact
                      />
                    </div>
                  </div>
                )}

                {/* Account Details */}
                <div className="border-b border-border pb-4 space-y-2">
                  <SectionHeader label="Account Details" />
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-fg-3">Account #</span>
                      <span className="font-medium">{supplier.accountNumber || "\u2014"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-fg-3">Payment Terms</span>
                      <span className="font-medium">{supplier.paymentTerms || "\u2014"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-fg-3">Lead Time</span>
                      <span className="font-medium">{supplier.defaultLeadTime || "\u2014"}</span>
                    </div>
                  </div>
                </div>

                {/* Summary */}
                <div className="border-b border-border pb-4 space-y-2">
                  <SectionHeader label="Summary" />
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-fg-3">Orders</span>
                      <span className="font-medium">{supplier._count?.orders ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-fg-3">Assets</span>
                      <span className="font-medium">{supplier._count?.assets ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-fg-3">Subhire Items</span>
                      <span className="font-medium">{supplier._count?.lineItems ?? 0}</span>
                    </div>
                  </div>
                </div>

                {/* Recent Orders (compact) */}
                {orders.length > 0 && (
                  <div className="border-b border-border pb-4 space-y-2">
                    <SectionHeader label="Recent Orders" />
                    <div className="space-y-1">
                      {orders.slice(0, 5).map((order) => (
                        <div
                          key={order.id}
                          className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono text-xs text-fg-3 shrink-0">
                              {order.orderNumber}
                            </span>
                            <Badge variant="outline" className="text-xs">{orderTypeLabels[order.type] || order.type}</Badge>
                          </div>
                          <StatusIndicator
                            category="supplierOrder"
                            value={order.status}
                            label={supplierOrderStatusLabels[order.status] || formatLabel(order.status)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Activity Timeline */}
                <div className="space-y-2">
                  <SectionHeader label="Activity" />
                  <ActivityTimeline entityType="supplier" entityId={id} />
                </div>
              </div>
            </div>
          </div>
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
    </RequirePermission>
  );
}
