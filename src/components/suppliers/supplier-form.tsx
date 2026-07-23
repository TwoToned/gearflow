"use client";

import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { toast } from "sonner";
import { Truck, Mail } from "lucide-react";

import { cn } from "@/lib/utils";
import { supplierSchema, type SupplierFormValues } from "@/lib/validations/supplier";
import { useSupplierWrites } from "@/hooks/use-supplier-writes";
import { useOrgTags } from "@/hooks/use-org-tags";
import { useActiveOrganization } from "@/lib/auth-client";
import { useOrgCountry } from "@/lib/use-org-country";
import { TagInput } from "@/components/ui/tag-input";
import { AddressInput } from "@/components/ui/address-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  SmartFormLayout, SmartFormRail, SmartFormPreview, SmartFormSection, SmartFormField, SmartFormActions,
} from "@/components/ui/smart-form";

interface SupplierFormProps {
  initialData?: SupplierFormValues & { id: string };
}

export function SupplierForm({ initialData }: SupplierFormProps) {
  const router = useRouter();
  const isEditing = !!initialData;
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const supplierWrites = useSupplierWrites();
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

  const v = form.watch();

  const mutation = useServerMutation({
    mutationFn: (data: SupplierFormValues) =>
      isEditing ? supplierWrites.update(initialData.id, data) : supplierWrites.create(data),
    onSuccess: (result) => {
      toast.success(isEditing ? "Supplier updated" : "Supplier created");
      router.push(`/suppliers/${result.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  // ─── Live-preview derivations ──────────────────────────────────
  const previewName = (v.name || "New supplier").trim();
  const primaryContact = (v.contactName || v.email || "").trim();

  const helperTip = !v.name
    ? "Your bench for when the warehouse comes up short — a name's enough to get them on the list."
    : !primaryContact
      ? "Add a contact so purchase orders reach the right desk."
      : "Looking good. Address, terms and lead time are optional — fill what you know.";

  return (
    <SmartFormLayout
      onSubmit={form.handleSubmit((d) => mutation.mutate(d))}
      aside={
        <>
          <SmartFormRail eyebrow={isEditing ? "Editing" : "New supplier"} tip={helperTip} />
          <SmartFormPreview>
            <div className="overflow-hidden rounded-[var(--r)] border border-line bg-card p-3 shadow-[var(--sh-card)]">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-[var(--r)] bg-paper-2 text-faint">
                  <Truck className="h-4 w-4" strokeWidth={1.5} />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className={cn("text-card-title font-semibold leading-tight", previewName === "New supplier" ? "text-faint" : "text-ink")}>
                    {previewName}
                  </p>
                  <p className={cn("flex items-center gap-1.5 text-caption", primaryContact ? "text-muted" : "text-faint")}>
                    <Mail className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                    {primaryContact || "No contact yet"}
                  </p>
                </div>
              </div>
            </div>
          </SmartFormPreview>
        </>
      }
    >
      <div className="space-y-8">
        {/* Identity */}
        <SmartFormSection title="Identity" hint="The vendor you buy or hire from." divider={false}>
          <SmartFormField label="Name" required error={form.formState.errors.name?.message}>
            <Input
              {...form.register("name")}
              placeholder="e.g. Sennheiser Australia"
              aria-invalid={!!form.formState.errors.name}
            />
          </SmartFormField>
        </SmartFormSection>

        {/* Contact */}
        <SmartFormSection title="Contact" hint="Where purchase orders and questions land.">
          <div className="grid gap-5 sm:grid-cols-2">
            <SmartFormField label="Contact name">
              <Input {...form.register("contactName")} placeholder="Primary contact person" />
            </SmartFormField>
            <SmartFormField label="Email" error={form.formState.errors.email?.message}>
              <Input
                type="email"
                {...form.register("email")}
                placeholder="email@example.com"
                aria-invalid={!!form.formState.errors.email}
              />
            </SmartFormField>
            <SmartFormField label="Phone">
              <Input {...form.register("phone")} placeholder="+61 400 000 000" />
            </SmartFormField>
            <SmartFormField label="Website">
              <Input {...form.register("website")} placeholder="https://example.com" />
            </SmartFormField>
          </div>
        </SmartFormSection>

        {/* Address */}
        <SmartFormSection title="Address" hint="Where they ship from or you collect.">
          <SmartFormField label="Address">
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
                    v.latitude != null && v.longitude != null
                      ? { latitude: v.latitude as number, longitude: v.longitude as number }
                      : null
                  }
                  placeholder="Supplier address"
                  countryCode={orgCountry}
                />
              )}
            />
          </SmartFormField>
        </SmartFormSection>

        {/* More details — progressive disclosure */}
        <section className="border-t border-line pt-6">
          <Accordion type="single" collapsible>
            <AccordionItem value="more" className="border-line">
              <AccordionTrigger>More details</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-5 pt-1">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <SmartFormField label="Account number" hint="Your account # with this supplier.">
                      <Input {...form.register("accountNumber")} placeholder="e.g. ACME-001" />
                    </SmartFormField>
                    <SmartFormField label="Payment terms">
                      <Input {...form.register("paymentTerms")} placeholder="e.g. Net 30, COD, Prepay" />
                    </SmartFormField>
                    <SmartFormField label="Default lead time">
                      <Input {...form.register("defaultLeadTime")} placeholder="e.g. 3-5 business days" />
                    </SmartFormField>
                  </div>
                  <SmartFormField label="Notes">
                    <Textarea {...form.register("notes")} placeholder="Any additional notes" rows={3} />
                  </SmartFormField>
                  <SmartFormField label="Tags">
                    <Controller
                      name="tags"
                      control={form.control}
                      render={({ field }) => (
                        <TagInput
                          value={field.value ?? []}
                          onChange={field.onChange}
                          suggestions={orgTags}
                          placeholder="Add tags…"
                        />
                      )}
                    />
                  </SmartFormField>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </section>
      </div>

      <SmartFormActions>
        <Button type="button" variant="line" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          {isEditing ? "Update supplier" : "Create supplier"}
        </Button>
      </SmartFormActions>
    </SmartFormLayout>
  );
}
