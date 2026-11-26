"use client";
// use-client: live Convex data via client subscription (useQuery) (R-8.1.1)

import { use, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronRight, FileText, Upload, X, Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { api } from "../../../../../../../convex/_generated/api";
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
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn, focusRing } from "@/lib/utils";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { Facts, HealthRows, Headline, RecordShell, type HealthItem, type RecordTab } from "@/components/people/record-shell";
import { HireDateDialog, type HireMode } from "@/components/suppliers/orders/hire-dialogs";
import { useStableNow } from "@/hooks/use-stable-now";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { OrderFilesPanel, type OrderFileRow } from "@/components/suppliers/record/order-files-panel";
import { useSupplierRecordWrites } from "@/components/suppliers/record/use-supplier-record-writes";
import { useCanDo } from "@/lib/use-permissions";
import { dayLabel } from "@/lib/list-views/people";
import { fileSizeLabel } from "@/lib/file-size";
import type { ActionMenuSpec } from "@/lib/primitives/types";
import { isOnHire, orderHireState, returnLateDays } from "../../../../../../../convex/lib/orderHireState";
import { SUPPLIER_INVOICE_FOLDER } from "../../../../../../../convex/lib/supplierRecordCore";

type OrderDetail = NonNullable<ReturnType<typeof useSupplierOrderDetail>>;

const INVOICE_ACCEPT = "application/pdf,image/*,.doc,.docx,.xls,.xlsx";

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
  const [deleteOpen, setDeleteOpen] = useState(false);

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
      <OrderRecord order={order} supplierId={supplierId} orderId={orderId} orgId={orgId} onEdit={() => router.push(`/suppliers/${supplierId}/orders/${orderId}?edit=1`)} onDelete={() => setDeleteOpen(true)} />

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
      formData.append("folder", SUPPLIER_INVOICE_FOLDER);
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

function InvoiceFile({
  invoice, onRemove, removing,
}: { invoice: NonNullable<OrderDetail["invoice"]>; onRemove: () => void; removing: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-[var(--r)] border border-line bg-paper-2/50 p-2.5">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-[var(--r)] bg-paper-2 text-muted">
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
        <p className="text-caption text-muted">{fileSizeLabel(invoice.fileSize)}</p>
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

// ─── The record (UX Phase 13, spec §9m): Overview · Lines · Files · History ──────────────

function OrderRecord({
  order, supplierId, orderId, orgId, onEdit, onDelete,
}: { order: OrderDetail; supplierId: string; orderId: string; orgId: string | undefined; onEdit: () => void; onDelete: () => void }) {
  const canUpdate = useCanDo("supplier", "update");
  const canDelete = useCanDo("supplier", "delete");
  const now = useStableNow();
  const recordWrites = useSupplierRecordWrites(orgId);
  const orderFiles = (useAuthedQuery(api.supplierRecord.orderFiles, orgId ? { orgId, orderId } : "skip") ?? []) as OrderFileRow[];
  const [hire, setHire] = useState<HireMode | null>(null);
  const hireOrder = { type: order.type, status: order.status, returnDueDate: order.returnDueDate, returnedDate: order.returnedDate };
  const state = orderHireState(hireOrder);
  const lateDays = returnLateDays(hireOrder, Math.floor(now / 86_400_000));
  const units = order.items.reduce((n, i) => n + (i.quantity ?? 0), 0);
  const day = (ms: number | null) => (ms == null ? null : dayLabel(Math.floor(ms / 86_400_000)));
  const onHire = isOnHire(hireOrder);

  const health: HealthItem[] = [
    ...(lateDays > 0 && canUpdate ? [{ key: "late", tone: "error" as const, text: `Return ${lateDays}d overdue · was due ${day(order.returnDueDate)}`, action: { label: "Extend hire", onSelect: () => setHire("extend") } }] : []),
    ...(!order.invoice && order.status === "RECEIVED" ? [{ key: "invoice", tone: "warning" as const, text: "Supplier invoice not attached" }] : []),
  ];
  const menu: ActionMenuSpec = {
    items: [
      ...(canUpdate && onHire ? [{ key: "extend", label: "Extend hire…", group: "edit" as const, onSelect: () => setHire("extend") }, { key: "return", label: "Mark returned…", group: "edit" as const, onSelect: () => setHire("return") }] : []),
      ...(canDelete ? [{ key: "delete", label: "Delete…", group: "danger" as const, icon: Trash2, danger: true, onSelect: onDelete, confirm: { title: `Delete ${order.orderNumber}?`, body: "This permanently removes the order and its line items. Orders with linked assets or a linked sub-hire can't be deleted.", confirmLabel: "Delete order" } }] : []),
    ],
  };
  const sub = order.type === "SUBHIRE" ? (order.returnedDate ? `Returned ${day(order.returnedDate)}` : order.returnDueDate ? `Return due ${day(order.returnDueDate)}` : undefined) : undefined;
  const intent = state.intent === "live" ? "primary" : state.intent === "warn" ? "warning" : state.intent === "ok" ? "success" : state.intent === "info" ? "info" : "neutral";

  const overview = (
    <div className="flex flex-col gap-8">
      <Headline sub={[sub, order.total != null ? formatCurrency(Number(order.total)) : null].filter(Boolean).join(" · ") || undefined}>
        {state.word}{units > 0 ? ` · ${units} unit${units === 1 ? "" : "s"}` : ""}
      </Headline>
      <HealthRows items={health} allClear="Nothing needs a look." />
      <div className="grid gap-8 md:grid-cols-3">
        <Facts title="Dates" facts={[
          { label: "Ordered", value: day(order.orderDate) },
          { label: order.type === "SUBHIRE" ? "Picked up" : "Received", value: day(order.receivedDate) },
          { label: "Expected", value: order.receivedDate ? null : day(order.expectedDate) },
          { label: "Return due", value: order.type === "SUBHIRE" ? day(order.returnDueDate) : null },
          { label: "Returned", value: order.type === "SUBHIRE" ? day(order.returnedDate) : null },
        ]} />
        <Facts title="Order" facts={[
          { label: "Type", value: supplierOrderTypeLabels[order.type] ?? order.type },
          { label: "Supplier", value: order.supplier ? <Link href={`/suppliers/${supplierId}`} className="hover:underline">{order.supplier.name}</Link> : null },
          { label: "Job", value: order.project ? <Link href={`/projects/${order.project.id}`} className="hover:underline">{order.project.projectNumber} {order.project.name}</Link> : null },
          { label: "Status", value: supplierOrderStatusLabels[order.status] ?? formatLabel(order.status) },
        ]} />
        <Facts title="Money" facts={[
          { label: "Subtotal", value: order.subtotal != null ? formatCurrency(Number(order.subtotal)) : null },
          { label: "Tax", value: order.taxAmount != null ? formatCurrency(Number(order.taxAmount)) : null },
          { label: "Total", value: order.total != null ? formatCurrency(Number(order.total)) : null },
        ]} />
      </div>
      {order.notes ? <p className="max-w-prose whitespace-pre-wrap text-table-cell text-ink-2">{order.notes}</p> : null}
    </div>
  );

  const tabs: RecordTab[] = [
    { value: "overview", label: "Overview", panel: overview },
    { value: "lines", label: "Lines", count: order.items.length, panel: <div className="space-y-6"><LineItemsPanel items={order.items} /><LinkedAssetsPanel assets={order.assets} /></div> },
    {
      value: "files", label: "Files", count: orderFiles.length + (order.invoice ? 1 : 0),
      panel: (
        <div className="space-y-8">
          <OrderFilesPanel files={orderFiles} canUpdate={canUpdate} onAdd={(file, kind, name) => recordWrites.addOrderFile(orderId, file, kind, name)} onRemove={(id, label) => recordWrites.removeOrderFile(orderId, id, label)} />
          <InvoiceSection order={order} orderId={orderId} />
        </div>
      ),
    },
    { value: "history", label: "History", panel: <ActivityTimeline entityType="supplierOrder" entityId={orderId} limit={25} /> },
  ];

  return (
    <>
      <RecordShell
        crumb={{ label: order.supplier?.name ?? "Supplier", href: `/suppliers/${supplierId}` }}
        title={order.orderNumber}
        status={{ label: state.word, intent }}
        meta={[supplierOrderTypeLabels[order.type] ?? order.type, order.project?.projectNumber, order.supplier?.name].filter(Boolean)}
        onEdit={canUpdate ? onEdit : undefined}
        menu={menu}
        tabs={tabs}
        rail={<Facts title="At a glance" facts={[{ label: "Supplier", value: order.supplier?.name }, { label: "Job", value: order.project?.projectNumber }, { label: "Lines", value: String(order.items.length) }]} />}
      />
      <HireDateDialog mode={hire} onOpenChange={(o) => !o && setHire(null)} orgId={orgId} order={{ id: orderId, orderNumber: order.orderNumber, returnDueDate: order.returnDueDate ?? null }} />
    </>
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
