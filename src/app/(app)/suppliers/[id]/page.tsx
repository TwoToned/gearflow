"use client";
// use-client: reads the route param and drives tab / dialog state (R-8.1.1)

import { use, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useConvex, useConvexAuth, useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { Archive, FilePlus, Mail, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../../../../convex/_generated/api";
import { orderHireState, returnLateDays } from "../../../../../convex/lib/orderHireState";

import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { RequirePermission } from "@/components/auth/require-permission";
import { Facts, HealthRows, Headline, RecordRows, RecordShell, type HealthItem, type RecordTab } from "@/components/people/record-shell";
import { AddressDisplay } from "@/components/ui/address-display";
import { FadeIn } from "@/components/ui/motion";
import { DetailPageSkeleton } from "@/components/ui/skeleton";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useServerQuery } from "@/hooks/use-server-query";
import { ContactsTab, DocumentsTab, documentHealthItems, type ContactRow, type DocumentRow } from "@/components/suppliers/record/people-tabs";
import { useSupplierRecordWrites } from "@/components/suppliers/record/use-supplier-record-writes";
import { useStableNow } from "@/hooks/use-stable-now";
import { useSupplierWrites } from "@/hooks/use-supplier-writes";
import { useSupplierOrdersBySupplier } from "@/hooks/use-supplier-orders";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import { formatCurrency } from "@/lib/formatters";
import { dayLabel } from "@/lib/list-views/people";
import type { ActionMenuSpec, StatusValue } from "@/lib/primitives/types";
import { supplierOrderTypeLabels, assetStatusLabels, supplierOrderStatusLabels } from "@/lib/status-labels";
import { useCanDo } from "@/lib/use-permissions";

const DAY_MS = 86_400_000;
const day = (ms: number) => dayLabel(Math.floor(ms / DAY_MS));

export default function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <RequirePermission resource="supplier" action="read">
      <FadeIn>
        <SupplierRecord params={params} />
      </FadeIn>
    </RequirePermission>
  );
}

type OrderRow = { id: string; orderNumber: string; type: string; status: string; returnDueDate?: number | null; returnedDate?: number | null; project: { id: string; projectNumber: string; name: string } | null; _count: { items: number }; total: number | null };

function orderStatus(o: OrderRow): StatusValue {
  const s = orderHireState({ type: o.type, status: o.status, returnDueDate: o.returnDueDate, returnedDate: o.returnedDate });
  const intent = s.intent === "live" ? "primary" : s.intent === "warn" ? "warning" : s.intent === "ok" ? "success" : s.intent === "info" ? "info" : "neutral";
  return { label: s.word, intent };
}

function SupplierRecord({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const convex = useConvex();
  const now = useStableNow();
  const { isAuthenticated } = useConvexAuth();
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const writes = useSupplierWrites();
  const setActiveMany = useMutation(api.peopleBulkWrites.setActiveManyNative);
  const canUpdate = useCanDo("supplier", "update");
  const canCreate = useCanDo("supplier", "create");
  const canDelete = useCanDo("supplier", "delete");

  const { data: supplier, isLoading } = useServerQuery({
    queryKey: ["supplier", orgId, id],
    enabled: !!orgId && isAuthenticated,
    queryFn: () => convex.query(api.suppliers.detail, { orgId: orgId!, id }),
  });
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
  const recordWrites = useSupplierRecordWrites(orgId);
  const contacts = (useAuthedQuery(api.supplierRecord.contacts, orgId && supplier ? { orgId, supplierId: id } : "skip") ?? []) as ContactRow[];
  const documents = (useAuthedQuery(api.supplierRecord.documents, orgId && supplier ? { orgId, supplierId: id } : "skip") ?? []) as DocumentRow[];
  const orders = useMemo(() => (ordersData?.orders ?? []) as unknown as OrderRow[], [ordersData]);

  if (isLoading) return <DetailPageSkeleton />;
  if (!supplier) return <p className="py-10 text-center text-ui-text text-muted">Supplier not found. It may have been deleted, or you don&apos;t have access to it.</p>;

  const today = Math.floor(now / DAY_MS);
  const active = supplier.isActive;
  const assets = assetsData?.assets ?? [];
  const subhires = subhiresData?.subHires ?? [];
  const onHire = orders.filter((o) => o.type === "SUBHIRE" && orderHireState(o).word === "On hire");
  const late = onHire.map((o) => ({ o, days: returnLateDays(o, today) })).filter((x) => x.days > 0);
  const openOrders = orders.filter((o) => ["DRAFT", "ORDERED", "PARTIAL"].includes(o.status));
  const actor = () => ({ userId: session?.user.id ?? "", userName: session?.user.name ?? "" });
  const setActive = (isActive: boolean) =>
    void setActiveMany({ orgId: orgId!, kind: "supplier", items: [{ id, auditId: createId() }], active: isActive, todayMs: Date.now(), now: Date.now(), actor: actor() }).then(() => toast.success(isActive ? "Supplier reactivated" : "Supplier archived"));

  // Delete sits behind Archive, and is absent while the supplier has orders (D74); the server guard stays.
  const canRemove = canDelete && !active && orders.length === 0;
  const menu: ActionMenuSpec = {
    items: [
      ...(canCreate && active ? [{ key: "new-order", label: "New order", group: "organise" as const, icon: FilePlus, onSelect: () => router.push(`/suppliers/${id}/orders/new`) }] : []),
      ...(supplier.email ? [{ key: "email", label: "Email supplier", group: "reporting" as const, icon: Mail, onSelect: () => { window.location.href = `mailto:${supplier.email}`; } }] : []),
      ...(canUpdate && !active ? [{ key: "reactivate", label: "Reactivate", group: "organise" as const, icon: RotateCcw, onSelect: () => setActive(true) }] : []),
      ...(canUpdate && active
        ? [{ key: "archive", label: "Archive…", group: "danger" as const, icon: Archive, danger: true, onSelect: () => setActive(false), confirm: { title: `Archive ${supplier.name}?`, body: "The supplier leaves pickers and the active list. Its orders, sub-hires and history stay as they were, and you can reactivate it.", confirmLabel: "Archive" } }]
        : []),
      ...(canRemove
        ? [{ key: "delete", label: "Delete…", group: "danger" as const, icon: Trash2, danger: true, onSelect: () => void writes.remove(id).then(() => { toast.success("Supplier deleted"); router.push("/suppliers"); }).catch((e: Error) => toast.error(e.message)), confirm: { title: `Delete ${supplier.name}?`, body: "This permanently removes the supplier and its rates. It cannot be undone, and it is only possible because it has no orders.", confirmLabel: "Delete supplier" } }]
        : []),
    ],
  };

  const health: HealthItem[] = [
    ...late.map(({ o, days }) => ({
      key: o.id, tone: "error" as const, text: `${o.orderNumber} return ${days}d overdue`, action: { label: "Extend or return", onSelect: () => router.push(`/suppliers/${id}/orders/${o.id}`) },
    })),
    ...documentHealthItems(documents, now, () => router.push(`/suppliers/${id}?tab=documents`)),
  ];
  const units = onHire.length;

  const overview = (
    <div className="flex flex-col gap-8">
      <Headline sub={`${openOrders.length} open order${openOrders.length === 1 ? "" : "s"}`}>
        {units > 0 ? `${units} order${units === 1 ? "" : "s"} on hire` : `${openOrders.length} open order${openOrders.length === 1 ? "" : "s"}`}
      </Headline>
      <HealthRows items={health} allClear="Nothing needs a look." />
      <div className="grid gap-8 md:grid-cols-3">
        <Facts title="Contact" facts={[
          { label: "Name", value: supplier.contactName },
          { label: "Email", value: supplier.email ? <a className="hover:underline" href={`mailto:${supplier.email}`}>{supplier.email}</a> : null },
          { label: "Phone", value: supplier.phone },
          { label: "Website", value: supplier.website },
        ]} />
        <Facts title="Address" facts={[{ label: "Address", value: supplier.address ? <AddressDisplay address={supplier.address} latitude={supplier.latitude} longitude={supplier.longitude} label={supplier.name} compact /> : null }]} />
        <Facts title="Account" facts={[
          { label: "Account #", value: supplier.accountNumber },
          { label: "Terms", value: supplier.paymentTerms },
          { label: "Lead time", value: supplier.defaultLeadTime },
          // Spend is the job-cost line: absent (not zero) without it.
          { label: "Spend", value: supplier.spend ? formatCurrency(supplier.spend.totalSpend) : null },
        ]} />
      </div>
      {supplier.notes ? <p className="max-w-prose whitespace-pre-wrap text-table-cell text-ink-2">{supplier.notes}</p> : null}
    </div>
  );

  const tabs: RecordTab[] = [
    { value: "overview", label: "Overview", panel: overview },
    {
      value: "orders", label: "Orders", count: orders.length,
      panel: <RecordRows noun="order" empty="No orders yet. Purchase and sub-hire orders appear here." rows={orders.map((o) => {
        const lateDays = returnLateDays(o, today);
        return {
          id: o.id, title: o.orderNumber, href: `/suppliers/${id}/orders/${o.id}`,
          meta: [supplierOrderTypeLabels[o.type] ?? o.type, o.project?.projectNumber, `${o._count.items} line${o._count.items === 1 ? "" : "s"}`, lateDays > 0 ? `return ${lateDays}d overdue` : null],
          status: orderStatus(o),
          trailing: o.total != null ? <span className="t-data text-ink-2">{formatCurrency(o.total)}</span> : undefined,
        };
      })} />,
    },
    {
      value: "subhires", label: "Sub-hires", count: subhires.length,
      panel: <RecordRows noun="sub-hire" empty="No sub-hire orders from this supplier." rows={subhires.map((s) => ({
        id: s.id, title: s.orderNumber, href: s.project ? `/projects/${s.project.id}` : undefined,
        meta: [s.project?.projectNumber, s.linkedOrder ? `PO ${s.linkedOrder.orderNumber}` : null, s.totalCost != null ? `cost ${formatCurrency(s.totalCost)}` : null, s.margin != null ? `margin ${formatCurrency(s.margin)}` : null],
        status: { label: supplierOrderStatusLabels[s.status] ?? s.status, intent: "neutral" } as StatusValue,
      }))} />,
    },
    {
      value: "assets", label: "Assets", count: supplier._count?.assets ?? assets.length,
      panel: <RecordRows noun="asset" empty="No assets from this supplier." rows={assets.map((a) => ({
        id: a.id, title: a.assetTag, href: `/assets/registry/${a.id}`, meta: [a.model?.name],
        status: { label: assetStatusLabels[a.status ?? ""] ?? a.status ?? "", intent: "neutral" } as StatusValue,
      }))} />,
    },
    {
      value: "contacts", label: "Contacts", count: contacts.length,
      panel: <ContactsTab contacts={contacts} canUpdate={canUpdate} onAdd={(v) => recordWrites.addContact(id, v)} onEdit={(cid, v) => recordWrites.updateContact(id, cid, v)} onRemove={(cid, label) => recordWrites.removeContact(id, cid, label)} />,
    },
    {
      value: "documents", label: "Documents", count: documents.length,
      panel: <DocumentsTab documents={documents} now={now} canUpdate={canUpdate} onAdd={(v, file) => recordWrites.addDocument(id, file, v)} onEdit={(did, v) => recordWrites.updateDocument(id, did, v)} onRemove={(did, name) => recordWrites.removeDocument(id, did, name)} />,
    },
    { value: "history", label: "History", panel: <ActivityTimeline entityType="supplier" entityId={id} limit={25} /> },
  ];

  return (
    <RecordShell
      crumb={{ label: "Suppliers", href: "/suppliers" }}
      title={supplier.name}
      status={active ? { label: "Active", intent: "success" } : { label: "Archived", intent: "neutral", outline: true }}
      meta={[supplier.contactName, `${openOrders.length} open order${openOrders.length === 1 ? "" : "s"}`].filter(Boolean)}
      banner={!active ? <span>Archived. Hidden from pickers; its orders, sub-hires and history stay as they were.</span> : undefined}
      onEdit={canUpdate ? () => router.push(`/suppliers/${id}/edit`) : undefined}
      menu={menu}
      tabs={tabs}
      rail={<Facts title="At a glance" facts={[{ label: "Contact", value: supplier.contactName }, { label: "Terms", value: supplier.paymentTerms }, { label: "On hire", value: units > 0 ? String(units) : null }]} />}
    />
  );
}
