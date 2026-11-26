"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useConvex, useConvexAuth } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import { useActiveOrganization } from "@/lib/auth-client";
import { useCanDo } from "@/lib/use-permissions";
import { useServerQuery } from "@/hooks/use-server-query";
import { useClient } from "@/hooks/use-clients";
import { useSupplier } from "@/hooks/use-suppliers";
import { useSupplierOrderDetail } from "@/hooks/use-supplier-orders";
import { ClientSheet } from "./client-sheet";
import { SupplierSheet } from "./supplier-sheet";
import { CrewSheet } from "./crew-sheet";
import { OrderSheet } from "./order-sheet";
import { clientToFormValues, crewToFormValues, orderToFormValues, supplierToFormValues } from "./edit-values";
import { EDIT_PARAM, NEW_ORDER_PARAM, NEW_PARAM, useSheetParam } from "./sheet-url";

/**
 * The ONE mount point of each People create / edit sheet, driven by the URL (`sheet-url.ts`) and hosted in the route
 * group's layout, so every page under `/clients`, `/suppliers` and `/crew` can open one with a plain link. A record
 * the URL names that does not exist (or is another organisation's) says so once and drops the param, never an empty
 * sheet. A create lands on the new record; an edit stays where it is (the record page is reactive).
 */
type RouteParams = { id?: string; orderId?: string };

/** An unknown record: say so once, close. */
function useMissing(missing: boolean, what: string, close: () => void) {
  useEffect(() => {
    if (!missing) return;
    toast.error(`${what} not found`);
    close();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per missing record
  }, [missing]);
}

function ClientEdit({ id, close }: { id: string; close: () => void }) {
  const client = useClient(id);
  useMissing(client === null, "Client", close);
  return client ? <ClientSheet key={client.id} initialData={clientToFormValues(client)} onClose={close} /> : null;
}

export function ClientSheetHost() {
  const { id } = useParams<RouteParams>();
  const router = useRouter();
  const create = useSheetParam(NEW_PARAM);
  const edit = useSheetParam(EDIT_PARAM);
  const canCreate = useCanDo("client", "create");
  const canUpdate = useCanDo("client", "update");
  if (id && edit.open && canUpdate) return <ClientEdit id={id} close={edit.close} />;
  if (!id && create.open && canCreate) return <ClientSheet onClose={create.close} onSaved={(r) => router.push(`/clients/${r.id}`)} />;
  return null;
}

function SupplierEdit({ id, close }: { id: string; close: () => void }) {
  const supplier = useSupplier(id);
  useMissing(supplier === null, "Supplier", close);
  return supplier ? <SupplierSheet key={supplier.id} initialData={supplierToFormValues(supplier)} onClose={close} /> : null;
}

function NewOrder({ supplierId, close }: { supplierId: string; close: () => void }) {
  const router = useRouter();
  const supplier = useSupplier(supplierId);
  useMissing(supplier === null, "Supplier", close);
  return supplier ? <OrderSheet supplierId={supplierId} supplierName={supplier.name} onClose={close} onSaved={(r) => router.push(`/suppliers/${supplierId}/orders/${r.id}`)} /> : null;
}

function OrderEdit({ supplierId, orderId, close }: { supplierId: string; orderId: string; close: () => void }) {
  const orgId = useActiveOrganization().data?.id;
  const order = useSupplierOrderDetail(orgId, orderId);
  useMissing(order === null, "Order", close);
  if (!order) return null;
  return <OrderSheet key={order.id} supplierId={supplierId} supplierName={order.supplier?.name ?? "this supplier"} initialData={orderToFormValues({ ...order, supplierId })} onClose={close} />;
}

export function SupplierSheetHost() {
  const { id, orderId } = useParams<RouteParams>();
  const router = useRouter();
  const create = useSheetParam(NEW_PARAM);
  const edit = useSheetParam(EDIT_PARAM);
  const newOrder = useSheetParam(NEW_ORDER_PARAM);
  const canCreate = useCanDo("supplier", "create");
  const canUpdate = useCanDo("supplier", "update");
  if (id && orderId && edit.open && canUpdate) return <OrderEdit supplierId={id} orderId={orderId} close={edit.close} />;
  if (id && !orderId && edit.open && canUpdate) return <SupplierEdit id={id} close={edit.close} />;
  if (id && !orderId && newOrder.open && canCreate) return <NewOrder supplierId={id} close={newOrder.close} />;
  if (!id && create.open && canCreate) return <SupplierSheet onClose={create.close} onSaved={(r) => router.push(`/suppliers/${r.id}`)} />;
  return null;
}

function CrewEdit({ id, close }: { id: string; close: () => void }) {
  const orgId = useActiveOrganization().data?.id;
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const { data: member, isLoading } = useServerQuery({
    queryKey: ["crew-member", orgId, id, isAuthenticated],
    queryFn: () => convex.query(api.crew.memberDetail, { id, orgId: orgId! }),
    enabled: !!orgId && isAuthenticated,
  });
  useMissing(!isLoading && !member, "Crew member", close);
  return member ? <CrewSheet key={id} initialData={crewToFormValues(id, member)} onClose={close} /> : null;
}

export function CrewSheetHost() {
  const { id } = useParams<RouteParams>();
  const create = useSheetParam(NEW_PARAM);
  const edit = useSheetParam(EDIT_PARAM);
  const canCreate = useCanDo("crew", "create");
  const canUpdate = useCanDo("crew", "update");
  if (id && edit.open && canUpdate) return <CrewEdit id={id} close={edit.close} />;
  // A crew create stays on the list (Save and add another keeps the sheet open; the toast names the person).
  if (!id && create.open && canCreate) return <CrewSheet onClose={create.close} />;
  return null;
}
