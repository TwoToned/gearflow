"use client";

import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { clientSchema, type ClientFormValues } from "@/lib/validations/client";
import { createClient, updateClient } from "@/server/clients";
import { getOrgTags } from "@/server/tags";
import { useActiveOrganization } from "@/lib/auth-client";
import { useOrgCountry } from "@/lib/use-org-country";
import { TagInput } from "@/components/ui/tag-input";
import { AddressInput } from "@/components/ui/address-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormSection } from "@/components/layout/page-layouts";

interface ClientFormProps {
  initialData?: ClientFormValues & { id: string };
}

export function ClientForm({ initialData }: ClientFormProps) {
  const router = useRouter();
  const isEditing = !!initialData;
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const orgCountry = useOrgCountry();

  const { data: orgTags } = useQuery({
    queryKey: ["org-tags", orgId],
    queryFn: () => getOrgTags(),
  });

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: initialData || {
      name: "",
      type: "COMPANY",
      contactName: "",
      contactEmail: "",
      contactPhone: "",
      billingAddress: "",
      billingLatitude: null,
      billingLongitude: null,
      shippingAddress: "",
      shippingLatitude: null,
      shippingLongitude: null,
      taxId: "",
      paymentTerms: "",
      defaultDiscount: undefined,
      notes: "",
      tags: [],
      isActive: true,
    },
  });

  const mutation = useMutation({
    mutationFn: (data: ClientFormValues) =>
      isEditing ? updateClient(initialData.id, data) : createClient(data),
    onSuccess: (result) => {
      toast.success(isEditing ? "Client updated" : "Client created");
      router.push(`/clients/${result.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))}>
      <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
        <div className="space-y-6">
          <FormSection title="Client Details">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" {...form.register("name")} placeholder="e.g. Acme Productions" />
              {form.formState.errors.name && (
                <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <select
                id="type"
                {...form.register("type")}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="COMPANY">Company</option>
                <option value="INDIVIDUAL">Individual</option>
                <option value="VENUE">Venue</option>
                <option value="PRODUCTION_COMPANY">Production Company</option>
              </select>
            </div>
          </FormSection>

          <FormSection title="Contact Information">
            <div className="space-y-2">
              <Label htmlFor="contactName">Contact Name</Label>
              <Input id="contactName" {...form.register("contactName")} placeholder="Primary contact person" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactEmail">Contact Email</Label>
              <Input id="contactEmail" type="email" {...form.register("contactEmail")} placeholder="email@example.com" />
              {form.formState.errors.contactEmail && (
                <p className="text-xs text-destructive">{form.formState.errors.contactEmail.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactPhone">Contact Phone</Label>
              <Input id="contactPhone" {...form.register("contactPhone")} placeholder="+61 400 000 000" />
            </div>
          </FormSection>

          <FormSection title="Billing">
            <div className="space-y-2 sm:col-span-2">
              <Label>Billing Address</Label>
              <Controller
                name="billingAddress"
                control={form.control}
                render={({ field }) => (
                  <AddressInput
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    onPlaceSelect={(place) => {
                      if (place) {
                        form.setValue("billingLatitude", place.latitude);
                        form.setValue("billingLongitude", place.longitude);
                      } else {
                        form.setValue("billingLatitude", null);
                        form.setValue("billingLongitude", null);
                      }
                    }}
                    initialCoordinates={
                      form.watch("billingLatitude") != null && form.watch("billingLongitude") != null
                        ? { latitude: form.watch("billingLatitude") as number, longitude: form.watch("billingLongitude") as number }
                        : null
                    }
                    placeholder="Billing address"
                    countryCode={orgCountry}
                  />
                )}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Shipping Address</Label>
              <Controller
                name="shippingAddress"
                control={form.control}
                render={({ field }) => (
                  <AddressInput
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    onPlaceSelect={(place) => {
                      if (place) {
                        form.setValue("shippingLatitude", place.latitude);
                        form.setValue("shippingLongitude", place.longitude);
                      } else {
                        form.setValue("shippingLatitude", null);
                        form.setValue("shippingLongitude", null);
                      }
                    }}
                    initialCoordinates={
                      form.watch("shippingLatitude") != null && form.watch("shippingLongitude") != null
                        ? { latitude: form.watch("shippingLatitude") as number, longitude: form.watch("shippingLongitude") as number }
                        : null
                    }
                    placeholder="Shipping address (if different)"
                    countryCode={orgCountry}
                  />
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="taxId">ABN</Label>
              <Input id="taxId" {...form.register("taxId")} placeholder="e.g. 12 345 678 901" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="paymentTerms">Payment Terms</Label>
              <Input id="paymentTerms" {...form.register("paymentTerms")} placeholder="e.g. Net 30" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="defaultDiscount">Default Discount (%)</Label>
              <Input
                id="defaultDiscount"
                type="number"
                step="0.01"
                min="0"
                max="100"
                {...form.register("defaultDiscount")}
                placeholder="0"
              />
            </div>
          </FormSection>

          <FormSection title="Additional">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" {...form.register("notes")} placeholder="Any additional notes" rows={3} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Tags</Label>
              <Controller
                name="tags"
                control={form.control}
                render={({ field }) => (
                  <TagInput
                    value={field.value ?? []}
                    onChange={field.onChange}
                    suggestions={orgTags}
                    placeholder="Add tags..."
                  />
                )}
              />
            </div>
          </FormSection>
        </div>

        <div className="mt-6 flex gap-3 border-t border-border pt-4">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? "Update Client" : "Create Client"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}
