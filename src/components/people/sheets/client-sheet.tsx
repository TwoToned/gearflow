"use client";

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { clientSchema, type ClientFormValues } from "@/lib/validations/client";
import { useClientWrites } from "@/hooks/use-native-client-writes";
import { clientTypeLabels } from "@/lib/status-labels";
import { useOrgTags } from "@/hooks/use-org-tags";
import { useActiveOrganization } from "@/lib/auth-client";
import { useOrgCountry } from "@/lib/use-org-country";
import { showError } from "@/lib/show-error";
import { TagInput } from "@/components/ui/tag-input";
import { AddressInput } from "@/components/ui/address-input";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormSheet } from "@/components/ui/form-sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { SmartFormSection, SmartFormField } from "@/components/ui/smart-form";
import { useSheetAnnounce } from "./use-sheet-announce";

/**
 * `ClientSheet` (UX Phase 13 slice 4): the ONE create and edit surface for a client, on `FormSheet` (it replaces the
 * `/clients/new` and `/clients/[id]/edit` pages, which redirect to `?new=1` / `?edit=1`). Every save toasts with the
 * server's exact Undo (`useSheetAnnounce`). Create is Save and Create; an edit sends the form's own fields only.
 */
interface ClientSheetProps {
  /** Edit: the stored values. Create: omit (or pass a preset such as `type`). */
  initialData?: ClientFormValues & { id: string };
  onClose: () => void;
  onSaved?: (r: { id: string }) => void;
}

const CREATE_DEFAULTS: ClientFormValues = {
  name: "", type: "COMPANY", contactName: "", contactEmail: "", contactPhone: "",
  billingAddress: "", billingLatitude: null, billingLongitude: null,
  shippingAddress: "", shippingLatitude: null, shippingLongitude: null,
  taxId: "", taxExempt: false, taxExemptReason: "", paymentTerms: "", defaultDiscount: undefined,
  paymentProfile: "FULL_UPFRONT", profileDepositPercent: undefined, notes: "", tags: [], isActive: true,
};

const CLIENT_TYPE_ORDER = ["COMPANY", "INDIVIDUAL", "VENUE", "PRODUCTION_COMPANY"] as const;

export function ClientSheet({ initialData, onClose, onSaved }: ClientSheetProps) {
  const isEditing = !!initialData;
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const orgCountry = useOrgCountry();
  const orgTags = useOrgTags(orgId);

  const form = useForm<ClientFormValues>({ resolver: zodResolver(clientSchema), defaultValues: initialData ?? CREATE_DEFAULTS });
  const v = form.watch();

  const clientWrites = useClientWrites();
  const announce = useSheetAnnounce("client");
  const [saving, setSaving] = useState(false);

  const submit = form.handleSubmit(async (data) => {
    setSaving(true);
    try {
      const saved = initialData ? await clientWrites.update(initialData.id, data) : await clientWrites.create(data);
      if (initialData) announce.updated("client", data.name, saved);
      else announce.created("client", data.name, saved);
      onClose();
      onSaved?.(saved);
    } catch (e) {
      showError(e, { fallbackTitle: "Could not save the client" });
    } finally {
      setSaving(false);
    }
  });

  return (
    <FormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={isEditing ? `Edit ${initialData.name || "client"}` : "New client"}
      description={isEditing ? undefined : "A name puts them on the books. Contacts and billing can wait until there is a quote to send."}
      primaryLabel={isEditing ? "Save" : "Create client"}
      onSubmit={submit}
      submitting={saving}
      dirty={form.formState.isDirty}
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

        {/* Contact — create-time only (WS9 #948): this seeds the PRIMARY contact
            as a separate clientContacts row right after the client is created.
            Editing contacts (adding more, changing the primary, etc.) moves to
            the contacts manager on the client detail page's sidebar. */}
        {!isEditing && (
          <SmartFormSection title="Contact" hint="Where quotes, dockets and invoices land. Add more contacts from the client's page once it's created.">
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
        )}

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
                  {/* T3 (#1091, docs/designs/tax-model.md §2) — a hard
                      short-circuit read by recalc: exempt = zero tax on every
                      one of this client's projects, regardless of any
                      project/line rate. */}
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-ui-text">
                      <Controller
                        control={form.control}
                        name="taxExempt"
                        render={({ field }) => (
                          <Checkbox checked={!!field.value} onCheckedChange={(checked) => field.onChange(checked === true)} />
                        )}
                      />
                      Tax exempt
                    </label>
                    {v.taxExempt && (
                      <SmartFormField label="Exemption reason" hint="Printed on documents instead of a tax line, e.g. a government PO or resale certificate.">
                        <Input {...form.register("taxExemptReason")} placeholder="e.g. Government purchase order #4471" />
                      </SmartFormField>
                    )}
                  </div>
                  {/* WS1 (#940), loosened when the rigid deposit-then-balance
                      sequencing was dropped in favour of an invoice menu
                      (partial balance / remaining balance, offered on every
                      project regardless of profile). Payment profile is now
                      just a label; the % field always applies — it's the
                      default a "Partial balance" invoice pre-fills, for ANY
                      client. Leaving it blank falls back to 25% at
                      invoice-create time (convex/invoicesWrites.ts). */}
                  <div className="grid gap-5 sm:grid-cols-2">
                    <SmartFormField label="Payment profile" hint="How this client is typically invoiced.">
                      <Controller control={form.control} name="paymentProfile" render={({ field }) => (
                        <Select value={field.value ?? "FULL_UPFRONT"} onValueChange={field.onChange}>
                          <SelectTrigger>
                            <SelectValue>
                              {field.value === "DEPOSIT_BALANCE" ? "Deposit + balance" : "Full amount upfront"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="FULL_UPFRONT">Full amount upfront</SelectItem>
                            <SelectItem value="DEPOSIT_BALANCE">Deposit + balance</SelectItem>
                          </SelectContent>
                        </Select>
                      )} />
                    </SmartFormField>
                    <SmartFormField label="Default partial (%)" hint="Of the tax-inclusive total. Default 25%.">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        {...form.register("profileDepositPercent")}
                        placeholder="25"
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

    </FormSheet>
  );
}
