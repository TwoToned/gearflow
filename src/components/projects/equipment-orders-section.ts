import type { LineRowListSection } from "@/components/ui/line-row";
import type { Fact, LineRowData, StatusValue } from "@/lib/primitives/types";
import { buildSubHireOrderActions } from "@/lib/row-actions/sub-hire-order";
import { getStatusIntent } from "@/lib/status-colors";
import { formatLabel, subHireStatusLabels } from "@/lib/status-labels";
import type { SubHireOrderStatus } from "@/lib/sub-hire-transitions";

/**
 * The Orders section (spec §7.5): the job's sub-hire orders pinned at the END
 * of the Equipment table, one row each. Pure: the rows carry the tab's own
 * handlers and never write anything. Rows are `selectable: false` (an order is
 * not a gear line the bulk verbs may touch). Totals are the order's stored
 * `totalCharge`/`totalCost`; nothing is summed here.
 */

const ORDERS_SECTION_ID = "orders";

/** The slice of a project sub-hire order the row reads (the bundle's shape is looser). */
export interface OrderSource {
  id: string;
  orderNumber: string;
  status: string;
  supplierId?: string | null;
  supplier?: { name?: string | null } | null;
  hireEnd?: string | Date | null;
  totalCharge?: number | null;
  totalCost?: number | null;
  _count?: { items?: number } | null;
}

export interface OrdersCtx {
  now: Date;
  showCost: boolean;
  onOpen: (subHireId: string) => void;
  onSetStatus: (subHireId: string, next: SubHireOrderStatus) => void;
}

const money = (n: number | null | undefined): Fact => ({ kind: "money", amount: n == null ? null : Number(n) });

function orderStatus(o: OrderSource, now: Date): StatusValue {
  const overdue = o.status === "ON_HIRE" && !!o.hireEnd && new Date(o.hireEnd) < now;
  if (overdue) return { label: "Overdue", intent: "error" };
  return {
    label: subHireStatusLabels[o.status] ?? formatLabel(o.status),
    intent: getStatusIntent("subHire", o.status),
    ...(o.status === "RETURNED" || o.status === "CANCELLED" ? { outline: true } : {}),
  };
}

function orderRow(o: OrderSource, c: OrdersCtx): LineRowData {
  const items = o._count?.items ?? 0;
  const open = () => c.onOpen(o.id);
  return {
    id: `order-${o.id}`,
    kind: "subhire",
    title: o.orderNumber,
    subtitle: o.supplier?.name ?? undefined,
    tags: [`${items} item${items === 1 ? "" : "s"}`],
    facts: { total: money(o.totalCharge), ...(c.showCost ? { cost: money(o.totalCost) } : {}) },
    status: orderStatus(o, c.now),
    selectable: false,
    onOpen: open,
    menu: buildSubHireOrderActions(
      { orderNumber: o.orderNumber, status: o.status },
      { onOpen: open, onSetStatus: (next) => c.onSetStatus(o.id, next) },
    ),
  };
}

/** `null` when the job has no orders (no empty section). */
export function buildOrdersSection(orders: OrderSource[], c: OrdersCtx): LineRowListSection | null {
  if (orders.length === 0) return null;
  return {
    section: { id: ORDERS_SECTION_ID, title: "Sub-hire orders", count: orders.length },
    rows: orders.map((o) => orderRow(o, c)),
  };
}
