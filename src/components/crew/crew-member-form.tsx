"use client";

import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { crewMemberSchema, type CrewMemberFormValues } from "@/lib/validations/crew";
import { createCrewMember, updateCrewMember, getOrgUsersForCrewLink } from "@/server/crew";
import { crewMemberTypeLabels, crewMemberStatusLabels } from "@/lib/status-labels";
import { useOrgTags } from "@/hooks/use-org-tags";
import { useCrewRoles } from "@/hooks/use-crew";
import { PersonAvatar } from "@/components/ui/avatar";
import { useActiveOrganization } from "@/lib/auth-client";
import { useOrgCountry } from "@/lib/use-org-country";
import { TagInput } from "@/components/ui/tag-input";
import { AddressInput } from "@/components/ui/address-input";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
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
  SmartFormLayout, SmartFormRail, SmartFormPreview, SmartFormSection, SmartFormField,
} from "@/components/ui/smart-form";

interface CrewMemberFormProps {
  initialData?: CrewMemberFormValues & { id: string };
}

const TYPE_ORDER = ["FREELANCER", "EMPLOYEE", "CONTRACTOR", "VOLUNTEER"] as const;
const STATUS_ORDER = ["ACTIVE", "INACTIVE", "ON_LEAVE", "ARCHIVED"] as const;

export function CrewMemberForm({ initialData }: CrewMemberFormProps) {
  const router = useRouter();
  const isEditing = !!initialData;
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const orgCountry = useOrgCountry();

  const orgTags = useOrgTags(orgId);
  const crewRoles = useCrewRoles(orgId) ?? [];

  const { data: linkableUsers } = useServerQuery({
    queryKey: ["crew-linkable-users", orgId],
    queryFn: () => getOrgUsersForCrewLink(),
  });

  const form = useForm<CrewMemberFormValues>({
    resolver: zodResolver(crewMemberSchema),
    defaultValues: initialData || {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      type: "FREELANCER",
      status: "ACTIVE",
      department: "",
      crewRoleId: "",
      defaultDayRate: "",
      defaultHourlyRate: "",
      overtimeMultiplier: "",
      currency: "",
      address: "",
      addressLatitude: null,
      addressLongitude: null,
      emergencyContactName: "",
      emergencyContactPhone: "",
      dateOfBirth: "",
      abnOrGst: "",
      notes: "",
      tags: [],
      userId: "",
      isActive: true,
    },
  });

  const v = form.watch();

  const mutation = useServerMutation({
    mutationFn: (data: CrewMemberFormValues) =>
      isEditing ? updateCrewMember(initialData.id, data) : createCrewMember(data),
    onSuccess: (result) => {
      toast.success(isEditing ? "Crew member updated" : "Crew member created");
      router.push(`/crew/${result.id}`);
    },
    onError: (e) => toast.error(e.message),
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

  // ─── Live-preview derivations ──────────────────────────────────
  const fullName = `${(v.firstName || "").trim()} ${(v.lastName || "").trim()}`.trim();
  const previewName = fullName || "New crew member";
  const typeLabel = crewMemberTypeLabels[v.type ?? "FREELANCER"] ?? "Freelancer";
  const dayRate = v.defaultDayRate !== "" && v.defaultDayRate != null ? Number(v.defaultDayRate) : null;
  const hourlyRate = v.defaultHourlyRate !== "" && v.defaultHourlyRate != null ? Number(v.defaultHourlyRate) : null;
  const rateLine = dayRate
    ? `$${dayRate.toFixed(2)} / day`
    : hourlyRate
      ? `$${hourlyRate.toFixed(2)} / hr`
      : null;

  const helperTip = !fullName
    ? "Who are we booking? A name does it — link their platform login and the details auto-fill."
    : !v.email && !v.phone
      ? "Add an email or phone so call sheets and offers reach them."
      : "Looking good. Rates and the rest are optional — fill what you know.";

  return (
    <SmartFormLayout
      onSubmit={form.handleSubmit((d) => mutation.mutate(d))}
      aside={
        <>
          <SmartFormRail eyebrow={isEditing ? "Editing" : "New crew member"} tip={helperTip} />
          <SmartFormPreview>
            <div className="overflow-hidden rounded-[var(--r)] border border-line bg-card p-3 shadow-[var(--sh-card)]">
              <div className="flex items-start gap-3">
                <PersonAvatar
                  name={fullName || "?"}
                  src={linkedUser?.image || undefined}
                  className="size-9 shrink-0"
                />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className={cn("text-card-title font-semibold leading-tight", previewName === "New crew member" ? "text-faint" : "text-ink")}>
                    {previewName}
                  </p>
                  <span className="inline-flex items-center rounded-full bg-paper-2 px-2 py-0.5 text-[11px] font-medium text-ink-2">
                    {typeLabel}
                  </span>
                  <p className={cn("text-caption", rateLine ? "text-muted" : "text-faint")}>
                    {rateLine || "No rate set"}
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

      <div className="mt-6 flex justify-end gap-3 border-t border-line pt-4">
        <Button type="button" variant="line" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          {isEditing ? "Update crew member" : "Create crew member"}
        </Button>
      </div>
    </SmartFormLayout>
  );
}
