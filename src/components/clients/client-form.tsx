"use client";

import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { toast } from "sonner";
import { Building2, Mail, User } from "lucide-react";

import { cn } from "@/lib/utils";
import { clientSchema, type ClientFormValues } from "@/lib/validations/client";
import { useClientWrites } from "@/hooks/use-native-client-writes";
import { clientTypeLabels } from "@/lib/status-labels";
import { useOrgTags } from "@/hooks/use-org-tags";
import { useActiveOrganization } from "@/lib/auth-client";
import { useOrgCountry } from "@/lib/use-org-country";
import { TagInput } from "@/components/ui/tag-input";
import { AddressInput } from "@/components/ui/address-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  SmartFormLayout, SmartFormRail, SmartFormPreview, SmartFormSection, SmartFormField, SmartFormActions, SmartFormPreviewPill,
} from "@/components/ui/smart-form";

interface ClientFormProps {
  initialData?: ClientFormValues & { id: string };
}

const CLIENT_TYPE_ORDER = ["COMPANY", "INDIVIDUAL", "VENUE", "PRODUCTION_COMPANY"] as const;

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

  const v = form.watch();

  const clientWrites = useClientWrites();
  const mutation = useServerMutation({
    mutationFn: (data: ClientFormValues) =>
      isEditing ? clientWrites.update(initialData.id, data) : clientWrites.create(data),
    onSuccess: (result) => {
      toast.success(isEditing ? "Client updated" : "Client created");
      router.push(`/clients/${result.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  // ─── Live-preview derivations ──────────────────────────────────
  const previewName = (v.name || "New client").trim();
  const typeLabel = clientTypeLabels[v.type ?? "COMPANY"] ?? "Company";
  const primaryContact = (v.contactName || v.contactEmail || "").trim();

  const helperTip = !v.name
    ? "A name puts them on the books. Wire up contacts and billing when there's actually a quote to send."
    : !primaryContact
      ? "Add a contact so quotes and dockets reach the right person."
      : "Looking good. Address and billing details are optional — fill what you know.";

  return (
    <SmartFormLayout
      onSubmit={form.handleSubmit((d) => mutation.mutate(d))}
      aside={
        <>
          <SmartFormRail eyebrow={isEditing ? "Editing" : "New client"} tip={helperTip} />
          <SmartFormPreview>
            <div className="overflow-hidden rounded-[var(--r)] border border-line bg-card p-3 shadow-[var(--sh-card)]">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-[var(--r)] bg-paper-2 text-faint">
                  {v.type === "INDIVIDUAL"
                    ? <User className="h-4 w-4" strokeWidth={1.5} />
                    : <Building2 className="h-4 w-4" strokeWidth={1.5} />}
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className={cn("text-card-title font-semibold leading-tight", previewName === "New client" ? "text-faint" : "text-ink")}>
                    {previewName}
                  </p>
                  <SmartFormPreviewPill>{typeLabel}</SmartFormPreviewPill>
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
        <SmartFormSection title="Identity" hint="Who they are and how to file them." divider={false}>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <SmartFormField label="Name" required error={form.formState.errors.name?.message}>
                <Input
                  {...form.register("name")}
                  placeholder="e.g. Acme Productions"
                  aria-invalid={!!form.formState.errors.name}
                />
              </SmartFormField>
            </div>
            <SmartFormField label="Type">
              <Controller control={form.control} name="type" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue>{clientTypeLabels[field.value ?? "COMPANY"] ?? "Company"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CLIENT_TYPE_ORDER.map((t) => (
                      <SelectItem key={t} value={t}>{clientTypeLabels[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )} />
            </SmartFormField>
          </div>
        </SmartFormSection>

        {/* Contact */}
        <SmartFormSection title="Contact" hint="Where quotes, dockets and invoices land.">
          <div className="grid gap-5 sm:grid-cols-2">
            <SmartFormField label="Contact name">
              <Input {...form.register("contactName")} placeholder="Primary contact person" />
            </SmartFormField>
            <SmartFormField label="Contact email" error={form.formState.errors.contactEmail?.message}>
              <Input
                type="email"
                {...form.register("contactEmail")}
                placeholder="email@example.com"
                aria-invalid={!!form.formState.errors.contactEmail}
              />
            </SmartFormField>
            <SmartFormField label="Contact phone">
              <Input {...form.register("contactPhone")} placeholder="+61 400 000 000" />
            </SmartFormField>
          </div>
        </SmartFormSection>

        {/* Address */}
        <SmartFormSection title="Address" hint="Billing and shipping — used on documents.">
          <div className="space-y-5">
            <SmartFormField label="Billing address">
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
                      v.billingLatitude != null && v.billingLongitude != null
                        ? { latitude: v.billingLatitude as number, longitude: v.billingLongitude as number }
                        : null
                    }
                    placeholder="Billing address"
                    countryCode={orgCountry}
                  />
                )}
              />
            </SmartFormField>
            <SmartFormField label="Shipping address" hint="Leave blank if same as billing.">
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
                      v.shippingLatitude != null && v.shippingLongitude != null
                        ? { latitude: v.shippingLatitude as number, longitude: v.shippingLongitude as number }
                        : null
                    }
                    placeholder="Shipping address (if different)"
                    countryCode={orgCountry}
                  />
                )}
              />
            </SmartFormField>
          </div>
        </SmartFormSection>

        {/* More details — progressive disclosure */}
        <section className="border-t border-line pt-6">
          <Accordion type="single" collapsible>
            <AccordionItem value="more" className="border-line">
              <AccordionTrigger>More details</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-5 pt-1">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <SmartFormField label="ABN">
                      <Input {...form.register("taxId")} placeholder="e.g. 12 345 678 901" />
                    </SmartFormField>
                    <SmartFormField label="Payment terms">
                      <Input {...form.register("paymentTerms")} placeholder="e.g. Net 30" />
                    </SmartFormField>
                    <SmartFormField label="Default discount (%)">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        {...form.register("defaultDiscount")}
                        placeholder="0"
                      />
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
          {isEditing ? "Update client" : "Create client"}
        </Button>
      </SmartFormActions>
    </SmartFormLayout>
  );
}
