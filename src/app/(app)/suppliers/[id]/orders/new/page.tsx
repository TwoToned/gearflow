"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supplierOrderSchema, type SupplierOrderFormValues } from "@/lib/validations/supplier-order";
import { createSupplierOrder } from "@/server/supplier-orders";
import { getSupplierById } from "@/server/suppliers";
import { useActiveOrganization } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="t-title text-fg">New Order</h1>
        <p className="text-muted-foreground">
          Create a purchase order for {supplier?.name || "..."}
        </p>
      </div>

      <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-6">
        <input type="hidden" {...form.register("supplierId")} />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Order Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea {...form.register("notes")} placeholder="Order notes..." rows={3} />
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Order
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
