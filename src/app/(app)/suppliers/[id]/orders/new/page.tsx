"use client";

import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import { toast } from "sonner";

import { supplierOrderSchema, type SupplierOrderFormValues } from "@/lib/validations/supplier-order";
import { createSupplierOrder } from "@/server/supplier-orders";
import { getSupplierById } from "@/server/suppliers";
import { useActiveOrganization } from "@/lib/auth-client";
import { RequirePermission } from "@/components/auth/require-permission";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormSection } from "@/components/layout/page-layouts";
import { FadeIn } from "@/components/ui/motion";
import { FormSkeleton } from "@/components/ui/skeleton";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

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

  return (
    <FadeIn>
      <div className="mx-auto max-w-3xl space-y-4">
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
            Create a purchase order for {supplier.name}
          </p>
        </div>

        <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))}>
          <input type="hidden" {...form.register("supplierId")} />

          <div className="rounded-[var(--r)] border border-line bg-card p-5 shadow-[var(--sh-card)] sm:p-6">
            <div className="space-y-6">
              <FormSection title="Order details">
                <div className="space-y-2">
                  <Label htmlFor="orderNumber">Order / PO number *</Label>
                  <Input id="orderNumber" {...form.register("orderNumber")} placeholder="e.g. PO-2024-001" aria-invalid={!!form.formState.errors.orderNumber} />
                  {form.formState.errors.orderNumber && (
                    <p className="text-caption text-t-out">{form.formState.errors.orderNumber.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type">Type</Label>
                  <select
                    id="type"
                    {...form.register("type")}
                    className="flex min-h-11 w-full rounded-[var(--radius)] border-2 border-input bg-card px-3.5 py-2 text-[16px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <option value="PURCHASE">Purchase</option>
                    <option value="SUBHIRE">Subhire</option>
                    <option value="REPAIR">Repair</option>
                    <option value="LABOUR">Labour</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <select
                    id="status"
                    {...form.register("status")}
                    className="flex min-h-11 w-full rounded-[var(--radius)] border-2 border-input bg-card px-3.5 py-2 text-[16px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <option value="DRAFT">Draft</option>
                    <option value="ORDERED">Ordered</option>
                    <option value="PARTIAL">Partial</option>
                    <option value="RECEIVED">Received</option>
                    <option value="CANCELLED">Cancelled</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="orderDate">Order date</Label>
                  <Input id="orderDate" type="date" {...form.register("orderDate")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expectedDate">Expected date</Label>
                  <Input id="expectedDate" type="date" {...form.register("expectedDate")} />
                </div>
              </FormSection>

              <FormSection title="Notes">
                <div className="sm:col-span-2">
                  <Textarea {...form.register("notes")} placeholder="Order notes..." rows={3} />
                </div>
              </FormSection>
            </div>

            <div className="mt-6 flex justify-end gap-3 border-t border-line pt-4">
              <Button type="button" variant="line" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" loading={mutation.isPending}>
                Create order
              </Button>
            </div>
          </div>
        </form>
      </div>
    </FadeIn>
  );
}
