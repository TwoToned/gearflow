"use client";

import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { toast } from "sonner";

import { supplierSchema, type SupplierFormValues } from "@/lib/validations/supplier";
import { createSupplier, updateSupplier } from "@/server/suppliers";
import { useOrgTags } from "@/hooks/use-org-tags";
import { useActiveOrganization } from "@/lib/auth-client";
import { useOrgCountry } from "@/lib/use-org-country";
import { TagInput } from "@/components/ui/tag-input";
import { AddressInput } from "@/components/ui/address-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormSection } from "@/components/layout/page-layouts";

interface SupplierFormProps {
  initialData?: SupplierFormValues & { id: string };
}

export function SupplierForm({ initialData }: SupplierFormProps) {
  const router = useRouter();
  const isEditing = !!initialData;
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const orgCountry = useOrgCountry();

  const orgTags = useOrgTags(orgId);

  const form = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierSchema),
    defaultValues: initialData || {
      name: "",
      contactName: "",
      email: "",
      phone: "",
      website: "",
      address: "",
      latitude: null,
      longitude: null,
      notes: "",
      accountNumber: "",
      paymentTerms: "",
      defaultLeadTime: "",
      tags: [],
      isActive: true,
    },
  });

  const mutation = useServerMutation({
    mutationFn: (data: SupplierFormValues) =>
      isEditing ? updateSupplier(initialData.id, data) : createSupplier(data),
    onSuccess: (result) => {
      toast.success(isEditing ? "Supplier updated" : "Supplier created");
      router.push(`/suppliers/${result.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))}>
      <div className="rounded-[var(--r)] border border-line bg-card p-5 shadow-[var(--sh-card)] sm:p-6">
        <div className="space-y-6">
          <FormSection title="Supplier details">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" {...form.register("name")} placeholder="e.g. Sennheiser Australia" aria-invalid={!!form.formState.errors.name} />
              {form.formState.errors.name && (
                <p className="text-caption text-t-out">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="accountNumber">Account number</Label>
              <Input id="accountNumber" {...form.register("accountNumber")} placeholder="Your account # with this supplier" />
            </div>
          </FormSection>

          <FormSection title="Contact information">
            <div className="space-y-2">
              <Label htmlFor="contactName">Contact name</Label>
              <Input id="contactName" {...form.register("contactName")} placeholder="Primary contact person" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" {...form.register("email")} placeholder="email@example.com" aria-invalid={!!form.formState.errors.email} />
              {form.formState.errors.email && (
                <p className="text-caption text-t-out">{form.formState.errors.email.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" {...form.register("phone")} placeholder="+61 400 000 000" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <Input id="website" {...form.register("website")} placeholder="https://example.com" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Address</Label>
              <Controller
                name="address"
                control={form.control}
                render={({ field }) => (
                  <AddressInput
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    onPlaceSelect={(place) => {
                      if (place) {
                        form.setValue("latitude", place.latitude);
                        form.setValue("longitude", place.longitude);
                      } else {
                        form.setValue("latitude", null);
                        form.setValue("longitude", null);
                      }
                    }}
                    initialCoordinates={
                      form.watch("latitude") != null && form.watch("longitude") != null
                        ? { latitude: form.watch("latitude") as number, longitude: form.watch("longitude") as number }
                        : null
                    }
                    placeholder="Supplier address"
                    countryCode={orgCountry}
                  />
                )}
              />
            </div>
          </FormSection>

          <FormSection title="Terms & lead time">
            <div className="space-y-2">
              <Label htmlFor="paymentTerms">Payment terms</Label>
              <Input id="paymentTerms" {...form.register("paymentTerms")} placeholder="e.g. Net 30, COD, Prepay" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="defaultLeadTime">Default lead time</Label>
              <Input id="defaultLeadTime" {...form.register("defaultLeadTime")} placeholder="e.g. 3-5 business days" />
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

        <div className="mt-6 flex justify-end gap-3 border-t border-line pt-4">
          <Button type="button" variant="line" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {isEditing ? "Update supplier" : "Create supplier"}
          </Button>
        </div>
      </div>
    </form>
  );
}
