"use client";
// use-client: live Convex data via client subscription (useQuery) (R-8.1.1)

import { use, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronRight, FileText, Upload, X, Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { useSupplierOrderDetail } from "@/hooks/use-supplier-orders";
import { useSupplierOrderWrites } from "@/hooks/use-supplier-order-writes";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useActiveOrganization } from "@/lib/auth-client";
import { assetStatusLabels, supplierOrderStatusLabels, supplierOrderTypeLabels, formatLabel } from "@/lib/status-labels";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { RequirePermission } from "@/components/auth/require-permission";
import { CanDo } from "@/components/auth/permission-gate";
import { PageMeta } from "@/components/layout/page-meta";
import { DetailLayout, DetailMain, DetailSidebar, SidebarSection } from "@/components/layout/page-layouts";
import { FadeIn } from "@/components/ui/motion";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { EmptyState } from "@/components/ui/empty-state";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn, focusRing } from "@/lib/utils";

const ORDER_STATUS_OPTIONS = ["DRAFT", "ORDERED", "PARTIAL", "RECEIVED", "CANCELLED"] as const;
type OrderStatus = (typeof ORDER_STATUS_OPTIONS)[number];

/** Date input value ("YYYY-MM-DD") from an epoch-ms timestamp, for pre-filling the edit form. */
function toDateInputValue(ms: number | null | undefined): string {
  if (!ms) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

type OrderDetail = NonNullable<ReturnType<typeof useSupplierOrderDetail>>;

const INVOICE_ACCEPT = "application/pdf,image/*,.doc,.docx,.xls,.xlsx";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SupplierOrderDetailPage({ params }: { params: Promise<{ id: string; orderId: string }> }) {
  return (
    <RequirePermission resource="supplier" action="read">
      <SupplierOrderDetailContent params={params} />
    </RequirePermission>
  );
}

// Kept thin (loading/not-found branches + composing the sections below) so its own
// complexity stays low (R-3.6) — each section below owns its own conditional
// rendering as an independently-scoped function instead of one large body.
function SupplierOrderDetailContent({ params }: { params: Promise<{ id: string; orderId: string }> }) {
  const { id: supplierId, orderId } = use(params);
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const order = useSupplierOrderDetail(orgId, orderId);
  const orderWrites = useSupplierOrderWrites();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const updateMutation = useServerMutation({
    mutationFn: (data: { status: OrderStatus; orderDate?: string; expectedDate?: string; notes?: string }) =>
      orderWrites.update(orderId, data),
    onSuccess: () => {
      toast.success("Order updated");
      setEditOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useServerMutation({
    mutationFn: () => orderWrites.remove(orderId),
    onSuccess: () => {
      toast.success("Order deleted");
      router.push(`/suppliers/${supplierId}`);
    },
    onError: (e) => toast.error(e.message),
  });

  if (order === undefined) return <DetailPageSkeleton />;

  if (order === null) {
    return (
      <div className="mx-auto max-w-3xl rounded-[var(--r-lg)] border border-line border-l-2 border-l-t-out bg-card p-6 text-center">
        <p className="text-ui-text text-ink-2">Order not found.</p>
        <p className="mt-1 text-caption text-muted">It may have been deleted, or you don&apos;t have access to it.</p>
        <Button variant="line" size="sm" className="mt-4" asChild>
          <Link href={`/suppliers/${supplierId}`}>Back to supplier</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <PageMeta title={order.orderNumber} />
      <FadeIn>
        <div className="space-y-6">
          <OrderHeroCard
            order={order}
            supplierId={supplierId}
            onEdit={() => setEditOpen(true)}
            onDelete={() => setDeleteOpen(true)}
          />
          <DetailLayout>
            <DetailMain>
              <div className="space-y-6">
                <LineItemsPanel items={order.items} />
                <LinkedAssetsPanel assets={order.assets} />
              </div>
            </DetailMain>
            <DetailSidebar>
              <OrderInfoSection order={order} />
              <InvoiceSection order={order} orderId={orderId} />
            </DetailSidebar>
          </DetailLayout>
        </div>
      </FadeIn>

      {/* Header edit dialog (WS7 #946 — the "Not built" edit flow FEATUREDOCS/22
          previously documented as out of scope for #789). */}
      <OrderEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        order={order}
        isPending={updateMutation.isPending}
        onConfirm={(data) => updateMutation.mutate(data)}
      />

      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete order?"
        description="This permanently removes the order and its line items. Orders with linked assets or a linked sub-hire can't be deleted."
        confirmLabel="Delete order"
        onConfirm={() => deleteMutation.mutate()}
        pending={deleteMutation.isPending}
      />
    </>
  );
}

function OrderHeroCard({
  order, supplierId, onEdit, onDelete,
}: { order: OrderDetail; supplierId: string; onEdit: () => void; onDelete: () => void }) {
  const typeLabel = supplierOrderTypeLabels[order.type] ?? order.type;
  const statusLabel = supplierOrderStatusLabels[order.status] ?? formatLabel(order.status);

  return (
    <div className="space-y-4 rounded-[var(--r-lg)] border-2 border-line bg-card p-4 shadow-[var(--sh-card)] sm:p-5">
      <nav className="flex items-center gap-1 text-caption text-muted">
        <Link href="/suppliers" className={cn("rounded-sm transition-colors hover:text-ink", focusRing)}>
          Suppliers
        </Link>
        <ChevronRight className="h-3 w-3" />
        <Link href={`/suppliers/${supplierId}`} className={cn("rounded-sm transition-colors hover:text-ink", focusRing)}>
          {order.supplier?.name ?? "Supplier"}
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="truncate text-ink-2 t-mono">{order.orderNumber}</span>
      </nav>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate font-display text-page-title font-extrabold text-ink t-mono">
              {order.orderNumber}
            </h1>
            <Badge status="neutral">{typeLabel}</Badge>
            <StatusIndicator category="supplierOrder" value={order.status} label={statusLabel} variant="pill" />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
            {order.supplier ? (
              <Link href={`/suppliers/${supplierId}`} className={cn("rounded-sm text-ink-2 hover:underline", focusRing)}>
                {order.supplier.name}
              </Link>
            ) : (
              <span>Unknown supplier</span>
            )}
            {order.project && (
              <>
                <span aria-hidden>&middot;</span>
                <Link href={`/projects/${order.project.id}`} className={cn("rounded-sm hover:text-ink-2 hover:underline", focusRing)}>
                  {order.project.projectNumber}
                </Link>
              </>
            )}
          </div>
        </div>

        <CanDo resource="supplier" action="update">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="line" size="sm" aria-label="More actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit order
              </DropdownMenuItem>
              <CanDo resource="supplier" action="delete">
                <DropdownMenuItem
                  onClick={onDelete}
                  className="text-red data-[highlighted]:bg-red data-[highlighted]:text-white"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete order
                </DropdownMenuItem>
              </CanDo>
            </DropdownMenuContent>
          </DropdownMenu>
        </CanDo>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--r)] border border-line bg-line sm:grid-cols-4">
        <HeroStat figure={String(order.items.length)} label="Line items" />
        <HeroStat figure={String(order.assets.length)} label="Linked assets" />
        <HeroStat figure={formatCurrency(order.total != null ? Number(order.total) : null)} label="Total" />
        <HeroStat figure={formatDate(order.expectedDate ? new Date(order.expectedDate) : null)} label="Expected" muted={!order.expectedDate} />
      </div>
    </div>
  );
}

function LineItemsPanel({ items }: { items: OrderDetail["items"] }) {
  return (
    <Panel padding="responsive">
      <h3 className="t-heading mb-4 text-ink">Line items</h3>
      {items.length === 0 ? (
        <EmptyState title="No line items" description="Items added to this order will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-[var(--r)] border border-line">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Asset</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Line total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => <LineItemRow key={item.id} item={item} />)}
            </TableBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}

function LineItemRow({ item }: { item: OrderDetail["items"][number] }) {
  return (
    <TableRow>
      <TableCell>{item.description}</TableCell>
      <TableCell className="text-muted">{item.model?.name ?? "—"}</TableCell>
      <TableCell>
        {item.asset ? (
          <Link href={`/assets/registry/${item.asset.id}`} className={cn("rounded-sm t-mono text-link hover:underline", focusRing)}>
            {item.asset.assetTag}
          </Link>
        ) : (
          <span className="text-muted">—</span>
        )}
      </TableCell>
      <TableCell className="text-right t-data">{item.quantity ?? 1}</TableCell>
      <TableCell className="text-right t-data">{item.unitPrice != null ? formatCurrency(Number(item.unitPrice)) : "—"}</TableCell>
      <TableCell className="text-right t-data">{item.lineTotal != null ? formatCurrency(Number(item.lineTotal)) : "—"}</TableCell>
    </TableRow>
  );
}

function LinkedAssetsPanel({ assets }: { assets: OrderDetail["assets"] }) {
  return (
    <Panel padding="responsive">
      <h3 className="t-heading mb-4 text-ink">Linked assets</h3>
      {assets.length === 0 ? (
        <EmptyState title="No assets linked" description="Assets bought against this order will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-[var(--r)] border border-line">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset tag</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assets.map((asset) => <LinkedAssetRow key={asset.id} asset={asset} />)}
            </TableBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}

function LinkedAssetRow({ asset }: { asset: OrderDetail["assets"][number] }) {
  return (
    <TableRow>
      <TableCell>
        <Link href={`/assets/registry/${asset.id}`} className={cn("rounded-sm t-mono font-medium text-ink hover:underline", focusRing)}>
          {asset.assetTag}
        </Link>
      </TableCell>
      <TableCell className="text-muted">{asset.model?.name ?? "—"}</TableCell>
      <TableCell>
        {asset.status ? (
          <StatusIndicator
            category="asset"
            value={asset.status}
            label={assetStatusLabels[asset.status] || formatLabel(asset.status)}
            variant="pill"
          />
        ) : "—"}
      </TableCell>
    </TableRow>
  );
}

function OrderInfoSection({ order }: { order: OrderDetail }) {
  const typeLabel = supplierOrderTypeLabels[order.type] ?? order.type;
  const statusLabel = supplierOrderStatusLabels[order.status] ?? formatLabel(order.status);

  return (
    <SidebarSection title="Order info">
      <dl className="space-y-3 text-ui-text">
        <InfoRow label="Type" value={typeLabel} />
        <InfoRow label="Status" value={statusLabel} />
        <InfoRow label="Order date" value={formatDate(order.orderDate ? new Date(order.orderDate) : null)} />
        <InfoRow label="Expected date" value={formatDate(order.expectedDate ? new Date(order.expectedDate) : null)} />
        <InfoRow label="Received date" value={formatDate(order.receivedDate ? new Date(order.receivedDate) : null)} />
        <InfoRow label="Subtotal" value={formatCurrency(order.subtotal != null ? Number(order.subtotal) : null)} />
        <InfoRow label="Tax" value={formatCurrency(order.taxAmount != null ? Number(order.taxAmount) : null)} />
        <InfoRow label="Total" value={formatCurrency(order.total != null ? Number(order.total) : null)} />
      </dl>
      {order.notes && (
        <p className="mt-3 whitespace-pre-wrap border-t border-line pt-3 text-caption text-muted">{order.notes}</p>
      )}
    </SidebarSection>
  );
}

function InvoiceSection({ order, orderId }: { order: OrderDetail; orderId: string }) {
  const orderWrites = useSupplierOrderWrites();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useServerMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("folder", "supplier-order-invoices");
      formData.append("entityId", orderId);
      const res = await fetch("/api/uploads", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "Upload failed");
      }
      const fileUpload: { id: string } = await res.json();
      return orderWrites.attachInvoice(orderId, fileUpload.id);
    },
    onSuccess: () => toast.success("Invoice attached"),
    onError: (e) => toast.error(e.message),
  });

  const removeInvoiceMutation = useServerMutation({
    mutationFn: () => orderWrites.removeInvoice(orderId),
    onSuccess: () => toast.success("Invoice removed"),
    onError: (e) => toast.error(e.message),
  });

  return (
    <SidebarSection title="Invoice" divider={false}>
      {order.invoice ? (
        <InvoiceFile invoice={order.invoice} onRemove={() => removeInvoiceMutation.mutate()} removing={removeInvoiceMutation.isPending} />
      ) : (
        <p className="text-caption text-muted">No invoice attached.</p>
      )}
      <CanDo resource="supplier" action="update">
        <input
          ref={fileInputRef}
          type="file"
          accept={INVOICE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadMutation.mutate(file);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="line"
          size="sm"
          className="mt-3 w-full"
          disabled={uploadMutation.isPending}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploadMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          {order.invoice ? "Replace invoice" : "Upload invoice"}
        </Button>
      </CanDo>
    </SidebarSection>
  );
}

/**
 * Header edit dialog (WS7 #946) — status (machine-guarded server-side)/orderDate/
 * expectedDate/notes only; orderNumber/type/supplierId/projectId are fixed at
 * creation. Resets its local state from `order` each time it opens.
 */
function OrderEditDialog({
  open, onOpenChange, order, isPending, onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: OrderDetail;
  isPending: boolean;
  onConfirm: (data: { status: OrderStatus; orderDate?: string; expectedDate?: string; notes?: string }) => void;
}) {
  const [status, setStatus] = useState<OrderStatus>(order.status as OrderStatus);
  const [orderDate, setOrderDate] = useState(toDateInputValue(order.orderDate));
  const [expectedDate, setExpectedDate] = useState(toDateInputValue(order.expectedDate));
  const [notes, setNotes] = useState(order.notes ?? "");

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (v) {
          setStatus(order.status as OrderStatus);
          setOrderDate(toDateInputValue(order.orderDate));
          setExpectedDate(toDateInputValue(order.expectedDate));
          setNotes(order.notes ?? "");
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit order</DialogTitle>
          <DialogDescription>Update the order&apos;s status, dates, and notes.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="order-edit-status">Status</Label>
            <Select value={status} onValueChange={(v) => v && setStatus(v as OrderStatus)}>
              <SelectTrigger id="order-edit-status">
                <SelectValue>{supplierOrderStatusLabels[status] ?? formatLabel(status)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ORDER_STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>{supplierOrderStatusLabels[s] ?? formatLabel(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="order-edit-order-date">Order date</Label>
              <Input id="order-edit-order-date" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="order-edit-expected-date">Expected date</Label>
              <Input id="order-edit-expected-date" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="order-edit-notes">Notes</Label>
            <Textarea id="order-edit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="line" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm({ status, orderDate: orderDate || undefined, expectedDate: expectedDate || undefined, notes: notes || undefined })}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InvoiceFile({
  invoice, onRemove, removing,
}: { invoice: NonNullable<OrderDetail["invoice"]>; onRemove: () => void; removing: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-[var(--r)] border border-line bg-paper-2/50 p-2.5">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-[var(--r)] bg-paper-2 text-faint">
        <FileText className="h-4 w-4" strokeWidth={1.5} />
      </div>
      <div className="min-w-0 flex-1">
        <a
          href={invoice.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn("block truncate text-ui-text font-medium text-ink hover:underline", focusRing)}
        >
          {invoice.fileName}
        </a>
        <p className="text-caption text-muted">{formatFileSize(invoice.fileSize)}</p>
      </div>
      <CanDo resource="supplier" action="update">
        <button
          type="button"
          aria-label="Remove invoice"
          disabled={removing}
          onClick={onRemove}
          className="shrink-0 rounded p-1 text-fg-3 hover:bg-destructive/10 hover:text-destructive"
        >
          {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
        </button>
      </CanDo>
    </div>
  );
}

function HeroStat({ figure, label, muted }: { figure: string; label: string; muted?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 bg-card p-3">
      <span className={cn("text-card-title font-bold", muted ? "text-faint" : "text-ink")}>{figure}</span>
      <span className="t-micro text-muted">{label}</span>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="text-right text-ink-2">{value}</dd>
    </div>
  );
}
