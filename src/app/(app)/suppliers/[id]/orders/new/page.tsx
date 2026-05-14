"use client";

import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supplierOrderSchema, type SupplierOrderFormValues } from "@/lib/validations/supplier-order";
import { createSupplierOrder } from "@/server/supplier-orders";
import { getSupplierById } from "@/server/suppliers";
import { useActiveOrganization } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormSection } from "@/components/layout/page-layouts";
import { FadeIn } from "@/components/ui/motion";

export default function NewSupplierOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: supplierId } = use(params);
  const router = useRouter();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: supplier } = useQuery({
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

  const mutation = useMutation({
    mutationFn: (data: SupplierOrderFormValues) => createSupplierOrder(data),
    onSuccess: () => {
      toast.success("Order created");
      router.push(`/suppliers/${supplierId}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <FadeIn>
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center gap-2 text-sm text-fg-3 mb-4">
          <Link href="/suppliers" className="hover:text-fg transition-colors">Suppliers</Link>
          <ChevronRight className="h-3 w-3" />
          <Link href={`/suppliers/${supplierId}`} className="hover:text-fg transition-colors">{supplier?.name || "..."}</Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-fg">New Order</span>
        </div>
        <div>
          <h1 className="t-title text-fg">New Order</h1>
          <p className="t-body text-fg-3">
            Create a purchase order for {supplier?.name || "..."}
          </p>
        </div>

        <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))}>
          <input type="hidden" {...form.register("supplierId")} />

          <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
            <div className="space-y-6">
              <FormSection title="Order Details">
                <div className="space-y-2">
                  <Label htmlFor="orderNumber">Order / PO Number *</Label>
                  <Input id="orderNumber" {...form.register("orderNumber")} placeholder="e.g. PO-2024-001" />
                  {form.formState.errors.orderNumber && (
                    <p className="text-xs text-destructive">{form.formState.errors.orderNumber.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type">Type</Label>
                  <select
                    id="type"
                    {...form.register("type")}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="DRAFT">Draft</option>
                    <option value="ORDERED">Ordered</option>
                    <option value="PARTIAL">Partial</option>
                    <option value="RECEIVED">Received</option>
                    <option value="CANCELLED">Cancelled</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="orderDate">Order Date</Label>
                  <Input id="orderDate" type="date" {...form.register("orderDate")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expectedDate">Expected Date</Label>
                  <Input id="expectedDate" type="date" {...form.register("expectedDate")} />
                </div>
              </FormSection>

              <FormSection title="Notes">
                <div className="sm:col-span-2">
                  <Textarea {...form.register("notes")} placeholder="Order notes..." rows={3} />
                </div>
              </FormSection>
            </div>

            <div className="mt-6 flex gap-3 border-t border-border pt-4">
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Order
              </Button>
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
            </div>
          </div>
        </form>
      </div>
    </FadeIn>
  );
}
