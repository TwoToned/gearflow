"use client";

import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import { toast } from "sonner";

import { crewMemberSchema, type CrewMemberFormValues } from "@/lib/validations/crew";
import { createCrewMember, updateCrewMember, getOrgUsersForCrewLink } from "@/server/crew";
import { useOrgTags } from "@/hooks/use-org-tags";
import { PersonAvatar } from "@/components/ui/avatar";
import { useActiveOrganization } from "@/lib/auth-client";
import { useOrgCountry } from "@/lib/use-org-country";
import { TagInput } from "@/components/ui/tag-input";
import { AddressInput } from "@/components/ui/address-input";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormSection } from "@/components/layout/page-layouts";

interface CrewMemberFormProps {
  initialData?: CrewMemberFormValues & { id: string };
}

export function CrewMemberForm({ initialData }: CrewMemberFormProps) {
  const router = useRouter();
  const isEditing = !!initialData;
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const orgCountry = useOrgCountry();

  const orgTags = useOrgTags(orgId);

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

  const mutation = useServerMutation({
    mutationFn: (data: CrewMemberFormValues) =>
      isEditing ? updateCrewMember(initialData.id, data) : createCrewMember(data),
    onSuccess: (result) => {
      toast.success(isEditing ? "Crew member updated" : "Crew member created");
      router.push(`/crew/${result.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const watchedUserId = form.watch("userId");
  const linkedUser = (linkableUsers || []).find(
    (u: { id: string }) => u.id === watchedUserId
  );

  // Auto-fill name and email when a user is selected
  function handleUserChange(newUserId: string) {
    form.setValue("userId", newUserId);
    if (newUserId) {
      const user = (linkableUsers || []).find((u: { id: string }) => u.id === newUserId);
      if (user) {
        // Auto-fill name from user account
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

  return (
    <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-6">
      <div className="rounded-[var(--r-lg)] bg-card p-5 ring-1 ring-line shadow-[var(--sh-card)] sm:p-6">
        <div className="space-y-6">
          <FormSection title="Platform account">
            <div className="space-y-3">
              <p className="text-caption text-muted">
                Link this crew member to a platform user to sync their name, email, and profile picture.
              </p>
              <Controller
                name="userId"
                control={form.control}
                render={({ field }) => (
                  <div className="space-y-2">
                    <ComboboxPicker
                      value={field.value || ""}
                      onChange={(v) => handleUserChange(v)}
                      options={(linkableUsers || [])
                        .filter((u: { id: string; alreadyLinked: boolean }) => !u.alreadyLinked || u.id === field.value)
                        .map((u: { id: string; name: string | null; email: string }) => ({
                          value: u.id,
                          label: u.name || u.email,
                          description: u.name ? u.email : undefined,
                        }))}
                      placeholder="Select user account..."
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
            </div>
          </FormSection>

          <FormSection title="Personal details">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="firstName">First name *</Label>
                <Input id="firstName" {...form.register("firstName")} placeholder="e.g. John" aria-invalid={!!form.formState.errors.firstName} />
                {form.formState.errors.firstName && (
                  <p className="text-caption text-t-out">{form.formState.errors.firstName.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last name *</Label>
                <Input id="lastName" {...form.register("lastName")} placeholder="e.g. Smith" aria-invalid={!!form.formState.errors.lastName} />
                {form.formState.errors.lastName && (
                  <p className="text-caption text-t-out">{form.formState.errors.lastName.message}</p>
                )}
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
                <Label htmlFor="dateOfBirth">Date of birth</Label>
                <Input id="dateOfBirth" type="date" {...form.register("dateOfBirth")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="abnOrGst">ABN / GST</Label>
                <Input id="abnOrGst" {...form.register("abnOrGst")} placeholder="e.g. 12 345 678 901" />
              </div>
            </div>
          </FormSection>

          <FormSection title="Employment">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={form.watch("type")}
                  onValueChange={(v) => form.setValue("type", v as CrewMemberFormValues["type"])}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type">
                      {({ FREELANCER: "Freelancer", EMPLOYEE: "Employee", CONTRACTOR: "Contractor", VOLUNTEER: "Volunteer" } as Record<string, string>)[form.watch("type") || ""] || "Select type"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FREELANCER">Freelancer</SelectItem>
                    <SelectItem value="EMPLOYEE">Employee</SelectItem>
                    <SelectItem value="CONTRACTOR">Contractor</SelectItem>
                    <SelectItem value="VOLUNTEER">Volunteer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={form.watch("status")}
                  onValueChange={(v) => form.setValue("status", v as CrewMemberFormValues["status"])}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select status">
                      {({ ACTIVE: "Active", INACTIVE: "Inactive", ON_LEAVE: "On leave", ARCHIVED: "Archived" } as Record<string, string>)[form.watch("status") || ""] || "Select status"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="INACTIVE">Inactive</SelectItem>
                    <SelectItem value="ON_LEAVE">On leave</SelectItem>
                    <SelectItem value="ARCHIVED">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="department">Department</Label>
                <Input id="department" {...form.register("department")} placeholder="e.g. Audio, Lighting, Video" />
              </div>
            </div>
          </FormSection>

          <FormSection title="Rates">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="defaultDayRate">Day rate ($)</Label>
                <Input id="defaultDayRate" type="number" step="0.01" {...form.register("defaultDayRate")} placeholder="0.00" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="defaultHourlyRate">Hourly rate ($)</Label>
                <Input id="defaultHourlyRate" type="number" step="0.01" {...form.register("defaultHourlyRate")} placeholder="0.00" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="overtimeMultiplier">Overtime multiplier</Label>
                <Input id="overtimeMultiplier" type="number" step="0.1" {...form.register("overtimeMultiplier")} placeholder="1.5" />
              </div>
            </div>
          </FormSection>

          <FormSection title="Address">
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
                    form.watch("addressLatitude") != null && form.watch("addressLongitude") != null
                      ? { latitude: form.watch("addressLatitude") as number, longitude: form.watch("addressLongitude") as number }
                      : null
                  }
                  placeholder="Home address"
                  countryCode={orgCountry}
                />
              )}
            />
          </FormSection>

          <FormSection title="Emergency contact">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="emergencyContactName">Contact name</Label>
                <Input id="emergencyContactName" {...form.register("emergencyContactName")} placeholder="Emergency contact name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="emergencyContactPhone">Contact phone</Label>
                <Input id="emergencyContactPhone" {...form.register("emergencyContactPhone")} placeholder="+61 400 000 000" />
              </div>
            </div>
          </FormSection>

          <FormSection title="Additional">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" {...form.register("notes")} placeholder="Any additional notes" rows={3} />
              </div>
              <div className="space-y-2">
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
            </div>
          </FormSection>

          <div className="mt-6 flex gap-3 border-t border-line pt-4">
            <Button type="submit" loading={mutation.isPending}>
              {isEditing ? "Update crew member" : "Create crew member"}
            </Button>
            <Button type="button" variant="line" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
