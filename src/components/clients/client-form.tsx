"use client";

import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { toast } from "sonner";

import { clientSchema, type ClientFormValues } from "@/lib/validations/client";
import { createClient, updateClient } from "@/server/clients";
import { useOrgTags } from "@/hooks/use-org-tags";
import { useActiveOrganization } from "@/lib/auth-client";
import { useOrgCountry } from "@/lib/use-org-country";
import { TagInput } from "@/components/ui/tag-input";
import { AddressInput } from "@/components/ui/address-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormSection, SectionHeader } from "@/components/layout/page-layouts";

interface ClientFormProps {
  initialData?: ClientFormValues & { id: string };
}

export function ClientForm({ initialData }: ClientFormProps) {
  const router = useRouter();
  const isEditing = !!initialData;
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const orgCountry = useOrgCountry();

  const orgTags = useOrgTags(orgId);

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

  const mutation = useServerMutation({
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
      <div className="rounded-[var(--r)] border border-line bg-card p-5 shadow-[var(--sh-card)] sm:p-6">
        <div className="space-y-8">
          <SectionHeader label="Client details" />
          <FormSection>
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" {...form.register("name")} placeholder="e.g. Acme Productions" aria-invalid={!!form.formState.errors.name} />
              {form.formState.errors.name && (
                <p className="text-caption text-t-out">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <select
                id="type"
                {...form.register("type")}
                className="flex min-h-11 w-full rounded-[var(--radius)] border-2 border-input bg-card px-3.5 py-2 text-[16px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:cursor-not-allowed disabled:opacity-45"
              >
                <option value="COMPANY">Company</option>
                <option value="INDIVIDUAL">Individual</option>
                <option value="VENUE">Venue</option>
                <option value="PRODUCTION_COMPANY">Production company</option>
              </select>
            </div>
          </FormSection>

          <SectionHeader label="Contact information" />
          <FormSection>
            <div className="space-y-2">
              <Label htmlFor="contactName">Contact name</Label>
              <Input id="contactName" {...form.register("contactName")} placeholder="Primary contact person" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactEmail">Contact email</Label>
              <Input id="contactEmail" type="email" {...form.register("contactEmail")} placeholder="email@example.com" aria-invalid={!!form.formState.errors.contactEmail} />
              {form.formState.errors.contactEmail && (
                <p className="text-caption text-t-out">{form.formState.errors.contactEmail.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactPhone">Contact phone</Label>
              <Input id="contactPhone" {...form.register("contactPhone")} placeholder="+61 400 000 000" />
            </div>
          </FormSection>

          <SectionHeader label="Billing" />
          <FormSection>
            <div className="space-y-2 sm:col-span-2">
              <Label>Billing address</Label>
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
              <Label>Shipping address</Label>
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
              <Label htmlFor="paymentTerms">Payment terms</Label>
              <Input id="paymentTerms" {...form.register("paymentTerms")} placeholder="e.g. Net 30" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="defaultDiscount">Default discount (%)</Label>
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

          <SectionHeader label="Additional" />
          <FormSection>
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

        <div className="mt-6 flex justify-end gap-3 border-t border-line pt-4">
          <Button type="button" variant="line" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {isEditing ? "Update client" : "Create client"}
          </Button>
        </div>
      </div>
    </form>
  );
}
