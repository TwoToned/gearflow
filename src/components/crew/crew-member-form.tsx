"use client";

import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { crewMemberSchema, type CrewMemberFormValues } from "@/lib/validations/crew";
import { createCrewMember, updateCrewMember, createCrewSkill, getOrgUsersForCrewLink } from "@/server/crew";
import { useCrewRoles, useCrewSkills } from "@/hooks/use-crew";
import { useOrgTags } from "@/hooks/use-org-tags";
import { UserAvatar } from "@/components/ui/user-avatar";
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
import { Badge } from "@/components/ui/badge";

interface CrewMemberFormProps {
  initialData?: CrewMemberFormValues & { id: string };
}

export function CrewMemberForm({ initialData }: CrewMemberFormProps) {
  const router = useRouter();
  const isEditing = !!initialData;
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const orgCountry = useOrgCountry();
  const [newSkillName, setNewSkillName] = useState("");

  const orgTags = useOrgTags(orgId);

  // Reactive crew roles + skills (Convex). Re-apply getCrewRoleOptions's active
  // filter + sortOrder/name sort, and getCrewSkillOptions's name sort, projecting
  // to the {id,name,…} shapes the selects expect.
  const roleDocs = useCrewRoles(orgId);
  const roleOptions = useMemo(
    () =>
      [...(roleDocs ?? [])]
        .filter((r) => r.isActive === true)
        .sort((a, b) => {
          const so = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
          return so !== 0 ? so : a.name.localeCompare(b.name);
        })
        .map((r) => ({ id: r.id, name: r.name, department: r.department ?? null })),
    [roleDocs],
  );

  const skillDocs = useCrewSkills(orgId);
  const skillOptions = useMemo(
    () =>
      [...(skillDocs ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => ({ id: s.id, name: s.name, category: s.category ?? null })),
    [skillDocs],
  );

  const { data: linkableUsers } = useQuery({
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
      skillIds: [],
      userId: "",
      isActive: true,
    },
  });

  const mutation = useMutation({
    mutationFn: (data: CrewMemberFormValues) =>
      isEditing ? updateCrewMember(initialData.id, data) : createCrewMember(data),
    onSuccess: (result) => {
      toast.success(isEditing ? "Crew member updated" : "Crew member created");
      router.push(`/crew/${result.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const selectedSkillIds = form.watch("skillIds") || [];
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
      <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
        <div className="space-y-6">
          <FormSection title="Platform Account">
            <div className="space-y-3">
              <p className="text-xs text-fg-3">
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
                      <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 p-2.5">
                        <UserAvatar user={{ name: linkedUser.name, image: linkedUser.image }} size="md" />
                        <div className="text-sm">
                          <p className="font-medium">{linkedUser.name}</p>
                          <p className="text-fg-3 text-xs">{linkedUser.email}</p>
                        </div>
                        <p className="ml-auto text-xs text-fg-3">Name, email &amp; photo synced from account</p>
                      </div>
                    )}
                  </div>
                )}
              />
            </div>
          </FormSection>

          <FormSection title="Personal Details">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name *</Label>
                <Input id="firstName" {...form.register("firstName")} placeholder="e.g. John" />
                {form.formState.errors.firstName && (
                  <p className="text-xs text-destructive">{form.formState.errors.firstName.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name *</Label>
                <Input id="lastName" {...form.register("lastName")} placeholder="e.g. Smith" />
                {form.formState.errors.lastName && (
                  <p className="text-xs text-destructive">{form.formState.errors.lastName.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" {...form.register("email")} placeholder="email@example.com" />
                {form.formState.errors.email && (
                  <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" {...form.register("phone")} placeholder="+61 400 000 000" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dateOfBirth">Date of Birth</Label>
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
                      {({ ACTIVE: "Active", INACTIVE: "Inactive", ON_LEAVE: "On Leave", ARCHIVED: "Archived" } as Record<string, string>)[form.watch("status") || ""] || "Select status"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="INACTIVE">Inactive</SelectItem>
                    <SelectItem value="ON_LEAVE">On Leave</SelectItem>
                    <SelectItem value="ARCHIVED">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="department">Department</Label>
                <Input id="department" {...form.register("department")} placeholder="e.g. Audio, Lighting, Video" />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Controller
                  name="crewRoleId"
                  control={form.control}
                  render={({ field }) => (
                    <ComboboxPicker
                      value={field.value || ""}
                      onChange={field.onChange}
                      options={(roleOptions || []).map((r: { id: string; name: string; department: string | null }) => ({
                        value: r.id,
                        label: r.name,
                        description: r.department || undefined,
                      }))}
                      placeholder="Select role..."
                      allowClear
                      creatable
                    />
                  )}
                />
              </div>
            </div>
          </FormSection>

          <FormSection title="Rates">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="defaultDayRate">Day Rate ($)</Label>
                <Input id="defaultDayRate" type="number" step="0.01" {...form.register("defaultDayRate")} placeholder="0.00" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="defaultHourlyRate">Hourly Rate ($)</Label>
                <Input id="defaultHourlyRate" type="number" step="0.01" {...form.register("defaultHourlyRate")} placeholder="0.00" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="overtimeMultiplier">Overtime Multiplier</Label>
                <Input id="overtimeMultiplier" type="number" step="0.1" {...form.register("overtimeMultiplier")} placeholder="1.5" />
              </div>
            </div>
          </FormSection>

          <FormSection title="Skills">
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {(skillOptions || []).map((skill: { id: string; name: string; category: string | null }) => {
                  const isSelected = selectedSkillIds.includes(skill.id);
                  return (
                    <Badge
                      key={skill.id}
                      variant={isSelected ? "default" : "outline"}
                      className="cursor-pointer select-none"
                      onClick={() => {
                        const current = form.getValues("skillIds") || [];
                        if (isSelected) {
                          form.setValue("skillIds", current.filter((id: string) => id !== skill.id));
                        } else {
                          form.setValue("skillIds", [...current, skill.id]);
                        }
                      }}
                    >
                      {skill.name}
                      {skill.category && <span className="ml-1 opacity-60">({skill.category})</span>}
                    </Badge>
                  );
                })}
                {(!skillOptions || skillOptions.length === 0) && (
                  <p className="text-sm text-fg-3">No skills defined yet. Add one below.</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="New skill name..."
                  value={newSkillName}
                  onChange={(e) => setNewSkillName(e.target.value)}
                  className="max-w-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (newSkillName.trim()) {
                        createCrewSkill({ name: newSkillName.trim() }).then((skill) => {
                          setNewSkillName("");
                          // Skill list is reactive (useCrewSkills) — appears on commit.
                          const current = form.getValues("skillIds") || [];
                          form.setValue("skillIds", [...current, skill.id]);
                          toast.success(`Skill "${skill.name}" created`);
                        }).catch((err) => toast.error(err.message));
                      }
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!newSkillName.trim()}
                  onClick={() => {
                    if (newSkillName.trim()) {
                      createCrewSkill({ name: newSkillName.trim() }).then((skill) => {
                        setNewSkillName("");
                        // Skill list is reactive (useCrewSkills) — appears on commit.
                        const current = form.getValues("skillIds") || [];
                        form.setValue("skillIds", [...current, skill.id]);
                        toast.success(`Skill "${skill.name}" created`);
                      }).catch((err) => toast.error(err.message));
                    }
                  }}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Add Skill
                </Button>
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

          <FormSection title="Emergency Contact">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="emergencyContactName">Contact Name</Label>
                <Input id="emergencyContactName" {...form.register("emergencyContactName")} placeholder="Emergency contact name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="emergencyContactPhone">Contact Phone</Label>
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

          <div className="mt-6 flex gap-3 border-t border-border pt-4">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Update Crew Member" : "Create Crew Member"}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
