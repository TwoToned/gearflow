"use client";

import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import { toast } from "sonner";
import { Truck } from "lucide-react";

import { cn } from "@/lib/utils";
import { supplierOrderSchema, type SupplierOrderFormValues } from "@/lib/validations/supplier-order";
import { createSupplierOrder } from "@/server/supplier-orders";
import { getSupplierById } from "@/server/suppliers";
import { supplierOrderStatusLabels } from "@/lib/status-labels";
import { useActiveOrganization } from "@/lib/auth-client";
import { RequirePermission } from "@/components/auth/require-permission";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FadeIn } from "@/components/ui/motion";
import { FormSkeleton } from "@/components/ui/skeleton";
import { StatusIndicator } from "@/components/ui/status-indicator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  SmartFormLayout, SmartFormRail, SmartFormPreview, SmartFormSection, SmartFormField,
} from "@/components/ui/smart-form";

const ORDER_TYPE_LABELS: Record<string, string> = {
  PURCHASE: "Purchase",
  SUBHIRE: "Subhire",
  REPAIR: "Repair",
  LABOUR: "Labour",
  OTHER: "Other",
};
const ORDER_TYPE_ORDER = ["PURCHASE", "SUBHIRE", "REPAIR", "LABOUR", "OTHER"] as const;
const ORDER_STATUS_ORDER = ["DRAFT", "ORDERED", "PARTIAL", "RECEIVED", "CANCELLED"] as const;

export default function NewSupplierOrderPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <RequirePermission resource="supplier" action="create">
      <NewSupplierOrderContent params={params} />
    </RequirePermission>
  );
}

function NewSupplierOrderContent({ params }: { params: Promise<{ id: string }> }) {
  const { id: supplierId } = use(params);
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: supplier, isLoading, error } = useServerQuery({
    queryKey: ["supplier", orgId, supplierId],
    queryFn: () => getSupplierById(supplierId),
  });

  const form = useForm<SupplierOrderFormValues>({
    resolver: zodResolver(supplierOrderSchema),
    defaultValues: {
      supplierId,
      orderNumber: "",
      type: "PURCHASE",
      status: "DRAFT",
      orderDate: "",
      expectedDate: "",
      notes: "",
    },
  });

  const mutation = useServerMutation({
    mutationFn: (data: SupplierOrderFormValues) => createSupplierOrder(data),
    onSuccess: () => {
      toast.success("Order created");
      router.push(`/suppliers/${supplierId}`);
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl">
        <FormSkeleton />
      </div>
    );
  }

  if (error || !supplier) {
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

  const v = form.watch();
  const orderRef = (v.orderNumber || "").trim();
  const typeLabel = ORDER_TYPE_LABELS[v.type ?? "PURCHASE"] ?? "Purchase";
  const statusLabel = supplierOrderStatusLabels[v.status ?? "DRAFT"] ?? "Draft";
  const expectedDate = v.expectedDate ? String(v.expectedDate) : "";

  const helperTip = !orderRef
    ? "Give it a reference you'll recognise later — a PO number, a quote ID, whatever you'll search for."
    : !v.expectedDate
      ? "Add an expected date so you can track what's still outstanding."
      : "Looking good. You can add line items once the order is created.";

  return (
    <FadeIn>
      <div className="space-y-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/suppliers" />}>Suppliers</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href={`/suppliers/${supplierId}`} />}>{supplier.name}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>New order</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div>
          <h1 className="font-display text-page-title font-extrabold tracking-tight text-ink">New order</h1>
          <p className="mt-1 text-ui-text text-muted">
            Create a purchase order for {supplier.name}.
          </p>
        </div>

        <SmartFormLayout
          onSubmit={form.handleSubmit((d) => mutation.mutate(d))}
          aside={
            <>
              <SmartFormRail eyebrow="New order" tip={helperTip} />
              <SmartFormPreview>
                <div className="overflow-hidden rounded-[var(--r)] border border-line bg-card p-3 shadow-[var(--sh-card)]">
                  <div className="flex items-start gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-[var(--r)] bg-paper-2 text-faint">
                      <Truck className="h-4 w-4" strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className={cn("text-card-title font-semibold leading-tight", orderRef ? "text-ink" : "text-faint")}>
                        {orderRef || "New order"}
                      </p>
                      <p className="truncate text-caption text-muted">{supplier.name}</p>
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <span className="inline-flex items-center rounded-full bg-paper-2 px-2 py-0.5 text-[11px] font-medium text-ink-2">
                          {typeLabel}
                        </span>
                        <StatusIndicator category="supplierOrder" value={v.status ?? "DRAFT"} label={statusLabel} variant="pill" />
                      </div>
                      <p className={cn("text-caption", expectedDate ? "text-muted" : "text-faint")}>
                        {expectedDate ? `Expected ${expectedDate}` : "No expected date"}
                      </p>
                    </div>
                  </div>
                </div>
              </SmartFormPreview>
            </>
          }
        >
          <input type="hidden" {...form.register("supplierId")} />

          <div className="space-y-8">
            {/* Order */}
            <SmartFormSection title="Order" hint={`Reference and classification for this ${supplier.name} order.`} divider={false}>
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <SmartFormField label="Order / PO number" required error={form.formState.errors.orderNumber?.message}>
                    <Input
                      {...form.register("orderNumber")}
                      placeholder="e.g. PO-2024-001"
                      aria-invalid={!!form.formState.errors.orderNumber}
                    />
                  </SmartFormField>
                </div>
                <SmartFormField label="Type">
                  <Controller control={form.control} name="type" render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue>{ORDER_TYPE_LABELS[field.value ?? "PURCHASE"] ?? "Purchase"}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {ORDER_TYPE_ORDER.map((t) => (
                          <SelectItem key={t} value={t}>{ORDER_TYPE_LABELS[t]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )} />
                </SmartFormField>
                <SmartFormField label="Status">
                  <Controller control={form.control} name="status" render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue>{supplierOrderStatusLabels[field.value ?? "DRAFT"] ?? "Draft"}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {ORDER_STATUS_ORDER.map((s) => (
                          <SelectItem key={s} value={s}>{supplierOrderStatusLabels[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )} />
                </SmartFormField>
              </div>
            </SmartFormSection>

            {/* Dates */}
            <SmartFormSection title="Dates" hint="Track when it was ordered and when to expect it.">
              <div className="grid gap-5 sm:grid-cols-2">
                <SmartFormField label="Order date">
                  <Input type="date" {...form.register("orderDate")} />
                </SmartFormField>
                <SmartFormField label="Expected date">
                  <Input type="date" {...form.register("expectedDate")} />
                </SmartFormField>
              </div>
            </SmartFormSection>

            {/* More details */}
            <SmartFormSection title="More details" hint="Anything else worth recording.">
              <SmartFormField label="Notes">
                <Textarea {...form.register("notes")} placeholder="Order notes…" rows={3} />
              </SmartFormField>
            </SmartFormSection>
          </div>

          <div className="mt-6 flex justify-end gap-3 border-t border-line pt-4">
            <Button type="button" variant="line" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Create order
            </Button>
          </div>
        </SmartFormLayout>
      </div>
    </FadeIn>
  );
}
