"use client";

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerQuery } from "@/hooks/use-server-query";

import { crewMemberSchema, type CrewMemberFormValues } from "@/lib/validations/crew";
import { useCrewWrites } from "@/hooks/use-crew-writes";
import { useConvex, useConvexAuth } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { crewMemberTypeLabels, crewMemberStatusLabels } from "@/lib/status-labels";
import { useOrgTags } from "@/hooks/use-org-tags";
import { useCrewRoles } from "@/hooks/use-crew";
import { PersonAvatar } from "@/components/ui/avatar";
import { useActiveOrganization } from "@/lib/auth-client";
import { useOrgCountry } from "@/lib/use-org-country";
import { TagInput } from "@/components/ui/tag-input";
import { AddressInput } from "@/components/ui/address-input";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { FormSheet } from "@/components/ui/form-sheet";
import { showError } from "@/lib/show-error";
import { useSheetAnnounce } from "./use-sheet-announce";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { SmartFormSection, SmartFormField } from "@/components/ui/smart-form";

/**
 * `CrewSheet` (UX Phase 13 slice 4): the ONE create and edit surface for a crew member, on `FormSheet` (it replaces the
 * `/crew/new` and `/crew/[id]/edit` pages, which redirect to `?new=1` / `?edit=1`). Create offers `Save and add another`
 * (a batch of freelancers); every save toasts with the server's exact Undo (`useSheetAnnounce`).
 */
interface CrewSheetProps {
  initialData?: CrewMemberFormValues & { id: string };
  onClose: () => void;
  onSaved?: (r: { id: string }) => void;
}

const CREATE_DEFAULTS: CrewMemberFormValues = {
  firstName: "", lastName: "", email: "", phone: "", type: "FREELANCER", status: "ACTIVE", department: "", crewRoleId: "",
  defaultDayRate: "", defaultHourlyRate: "", overtimeMultiplier: "", currency: "", address: "", addressLatitude: null,
  addressLongitude: null, emergencyContactName: "", emergencyContactPhone: "", dateOfBirth: "", abnOrGst: "", notes: "",
  tags: [], userId: "", isActive: true,
};

const TYPE_ORDER = ["FREELANCER", "EMPLOYEE", "CONTRACTOR", "VOLUNTEER"] as const;
const STATUS_ORDER = ["ACTIVE", "INACTIVE", "ON_LEAVE", "ARCHIVED"] as const;

export function CrewSheet({ initialData, onClose, onSaved }: CrewSheetProps) {
  const isEditing = !!initialData;
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const orgCountry = useOrgCountry();

  const orgTags = useOrgTags(orgId);
  const crewRoles = useCrewRoles(orgId) ?? [];
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const crewWrites = useCrewWrites();

  const { data: linkableUsers } = useServerQuery({
    queryKey: ["crew-linkable-users", orgId, isAuthenticated],
    queryFn: () => convex.query(api.crew.orgUsersForCrewLink, { orgId: orgId! }),
    enabled: !!orgId && isAuthenticated,
  });

  const form = useForm<CrewMemberFormValues>({ resolver: zodResolver(crewMemberSchema), defaultValues: initialData ?? CREATE_DEFAULTS });

  const v = form.watch();

  const announce = useSheetAnnounce("crew");
  const [saving, setSaving] = useState(false);

  /** The ONE save. `again` keeps the sheet open for the next person: type, status and department carry over. */
  const save = (again: boolean) => form.handleSubmit(async (data) => {
    setSaving(true);
    try {
      const saved = initialData ? await crewWrites.update(initialData.id, data) : await crewWrites.create(data);
      const name = `${data.firstName} ${data.lastName}`.trim();
      if (initialData) announce.updated("crew member", name, saved);
      else announce.created("crew member", name, saved);
      onSaved?.(saved);
      if (again) form.reset({ ...CREATE_DEFAULTS, type: data.type, status: data.status, department: data.department });
      else onClose();
    } catch (e) {
      showError(e, { fallbackTitle: "Could not save the crew member" });
    } finally {
      setSaving(false);
    }
  });

  const linkedUser = (linkableUsers || []).find(
    (u: { id: string }) => u.id === v.userId,
  );

  // Auto-fill name and email when a user is selected
  function handleUserChange(newUserId: string) {
    form.setValue("userId", newUserId);
    if (newUserId) {
      const user = (linkableUsers || []).find((u: { id: string }) => u.id === newUserId);
      if (user) {
        if (user.name) {
          const parts = user.name.split(" ");
          form.setValue("firstName", parts[0] || "");
          form.setValue("lastName", parts.slice(1).join(" ") || "");
        }
        if (user.email) {
          form.setValue("email", user.email);
        }
      }
    }
  }

  const fullName = `${(v.firstName || "").trim()} ${(v.lastName || "").trim()}`.trim();

  return (
    <FormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={isEditing ? `Edit ${fullName || "crew member"}` : "New crew member"}
      description={isEditing ? undefined : "Who are we booking? A name does it. Link their platform login and the details fill in."}
      primaryLabel={isEditing ? "Save" : "Create crew member"}
      onSubmit={save(false)}
      submitting={saving}
      dirty={form.formState.isDirty}
      addAnother={isEditing ? undefined : { label: "Save and add another", onSelect: save(true) }}
    >
      <div className="space-y-8">
        {/* Identity */}
        <SmartFormSection title="Identity" hint="Who they are and how to file them." divider={false}>
          <div className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <SmartFormField label="First name" required error={form.formState.errors.firstName?.message}>
                <Input
                  {...form.register("firstName")}
                  placeholder="e.g. John"
                  aria-invalid={!!form.formState.errors.firstName}
                />
              </SmartFormField>
              <SmartFormField label="Last name" required error={form.formState.errors.lastName?.message}>
                <Input
                  {...form.register("lastName")}
                  placeholder="e.g. Smith"
                  aria-invalid={!!form.formState.errors.lastName}
                />
              </SmartFormField>
              <SmartFormField label="Type">
                <Controller control={form.control} name="type" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue>{crewMemberTypeLabels[field.value ?? "FREELANCER"] ?? "Freelancer"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {TYPE_ORDER.map((t) => (
                        <SelectItem key={t} value={t}>{crewMemberTypeLabels[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )} />
              </SmartFormField>
              <SmartFormField label="Status">
                <Controller control={form.control} name="status" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue>{crewMemberStatusLabels[field.value ?? "ACTIVE"] ?? "Active"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_ORDER.map((s) => (
                        <SelectItem key={s} value={s}>{crewMemberStatusLabels[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )} />
              </SmartFormField>
            </div>
            <SmartFormField
              label="Platform account"
              hint="Link a platform user to sync their name, email and profile picture."
            >
              <Controller
                name="userId"
                control={form.control}
                render={({ field }) => (
                  <div className="space-y-2">
                    <ComboboxPicker
                      value={field.value || ""}
                      onChange={(val) => handleUserChange(val)}
                      options={(linkableUsers || [])
                        .filter((u: { id: string; alreadyLinked: boolean }) => !u.alreadyLinked || u.id === field.value)
                        .map((u: { id: string; name: string | null; email: string }) => ({
                          value: u.id,
                          label: u.name || u.email,
                          description: u.name ? u.email : undefined,
                        }))}
                      placeholder="No linked account"
                      searchPlaceholder="Search members…"
                      emptyMessage="No members found."
                      allowClear
                    />
                    {linkedUser && (
                      <div className="flex items-center gap-2 rounded-[var(--r)] border border-line bg-elev p-2.5">
                        <PersonAvatar name={linkedUser.name || linkedUser.email} src={linkedUser.image || undefined} className="size-10" />
                        <div className="text-ui-text">
                          <p className="font-medium text-ink">{linkedUser.name}</p>
                          <p className="text-caption text-muted">{linkedUser.email}</p>
                        </div>
                        <p className="ml-auto text-caption text-muted">Name, email &amp; photo synced from account</p>
                      </div>
                    )}
                  </div>
                )}
              />
            </SmartFormField>
          </div>
        </SmartFormSection>

        {/* Contact */}
        <SmartFormSection title="Contact" hint="Where offers, call sheets and updates land.">
          <div className="grid gap-5 sm:grid-cols-2">
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
          </div>
        </SmartFormSection>

        {/* Rates */}
        <SmartFormSection title="Rates" hint="Defaults used when scheduling — override per assignment.">
          <div className="grid gap-5 sm:grid-cols-3">
            <SmartFormField label="Day rate ($)">
              <Input type="number" step="0.01" {...form.register("defaultDayRate")} placeholder="0.00" />
            </SmartFormField>
            <SmartFormField label="Hourly rate ($)">
              <Input type="number" step="0.01" {...form.register("defaultHourlyRate")} placeholder="0.00" />
            </SmartFormField>
            <SmartFormField label="Overtime multiplier">
              <Input type="number" step="0.1" {...form.register("overtimeMultiplier")} placeholder="1.5" />
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
                    <SmartFormField label="Department">
                      <Input {...form.register("department")} placeholder="e.g. Audio, Lighting, Video" />
                    </SmartFormField>
                    <SmartFormField label="Default role">
                      <Controller control={form.control} name="crewRoleId" render={({ field }) => (
                        <ComboboxPicker
                          value={field.value || ""}
                          onChange={field.onChange}
                          options={(crewRoles as Array<{ id: string; name: string }>).map((r) => ({
                            value: r.id,
                            label: r.name,
                          }))}
                          placeholder="No default role"
                          searchPlaceholder="Search roles…"
                          emptyMessage="No roles found."
                          allowClear
                        />
                      )} />
                    </SmartFormField>
                    <SmartFormField label="Date of birth">
                      <Input type="date" {...form.register("dateOfBirth")} />
                    </SmartFormField>
                    <SmartFormField label="ABN / GST">
                      <Input {...form.register("abnOrGst")} placeholder="e.g. 12 345 678 901" />
                    </SmartFormField>
                  </div>

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
                              form.setValue("addressLatitude", place.latitude);
                              form.setValue("addressLongitude", place.longitude);
                            } else {
                              form.setValue("addressLatitude", null);
                              form.setValue("addressLongitude", null);
                            }
                          }}
                          initialCoordinates={
                            v.addressLatitude != null && v.addressLongitude != null
                              ? { latitude: v.addressLatitude as number, longitude: v.addressLongitude as number }
                              : null
                          }
                          placeholder="Home address"
                          countryCode={orgCountry}
                        />
                      )}
                    />
                  </SmartFormField>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <SmartFormField label="Emergency contact name">
                      <Input {...form.register("emergencyContactName")} placeholder="Emergency contact name" />
                    </SmartFormField>
                    <SmartFormField label="Emergency contact phone">
                      <Input {...form.register("emergencyContactPhone")} placeholder="+61 400 000 000" />
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
