"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, X, ChevronDown } from "lucide-react";
import { toast } from "sonner";

import {
  projectSchema,
  type ProjectFormValues,
} from "@/lib/validations/project";
import { createProject, updateProject } from "@/server/projects";
import { addProjectManager, removeProjectManager } from "@/server/project-managers";
import { getClients } from "@/server/clients";
import { getLocations } from "@/server/locations";
import { getOrgMembers } from "@/server/org-members";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormSection, SectionHeader } from "@/components/layout/page-layouts";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { QuickCreateClient } from "@/components/clients/quick-create-client";
import { QuickCreateLocation } from "@/components/assets/quick-create-location";
import { useActiveOrganization } from "@/lib/auth-client";
import { getOrgTags } from "@/server/tags";
import { TagInput } from "@/components/ui/tag-input";

interface ProjectFormProps {
  initialData?: ProjectFormValues & { id: string; isTemplate?: boolean };
  isTemplate?: boolean;
  initialManagerIds?: string[];
}

const TYPE_OPTIONS = [
  { value: "DRY_HIRE", label: "Dry Hire" },
  { value: "WET_HIRE", label: "Wet Hire" },
  { value: "INSTALLATION", label: "Installation" },
  { value: "TOUR", label: "Tour" },
  { value: "CORPORATE", label: "Corporate" },
  { value: "THEATRE", label: "Theatre" },
  { value: "FESTIVAL", label: "Festival" },
  { value: "CONFERENCE", label: "Conference" },
  { value: "OTHER", label: "Other" },
] as const;

const STATUS_OPTIONS = [
  { value: "ENQUIRY", label: "Enquiry" },
  { value: "QUOTING", label: "Quoting" },
  { value: "QUOTED", label: "Quoted" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "PREPPING", label: "Prepping" },
  { value: "CHECKED_OUT", label: "Checked Out" },
  { value: "ON_SITE", label: "On Site" },
  { value: "RETURNED", label: "Returned" },
  { value: "COMPLETED", label: "Completed" },
  { value: "INVOICED", label: "Invoiced" },
  { value: "CANCELLED", label: "Cancelled" },
] as const;

function formatDateForInput(date: unknown): string {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(String(date));
  if (isNaN(d.getTime())) return "";
  return d.toISOString().split("T")[0];
}

export function ProjectForm({ initialData, isTemplate: isTemplateProp, initialManagerIds = [] }: ProjectFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const isEditing = !!initialData;
  const isTemplate = isTemplateProp ?? initialData?.isTemplate ?? false;
  const [quickCreateClientOpen, setQuickCreateClientOpen] = useState(false);
  const [quickCreateLocationOpen, setQuickCreateLocationOpen] = useState(false);
  const [selectedManagerIds, setSelectedManagerIds] = useState<string[]>(initialManagerIds);

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: initialData
      ? {
          ...initialData,
          loadInDate: formatDateForInput(initialData.loadInDate) || undefined,
          eventStartDate: formatDateForInput(initialData.eventStartDate) || undefined,
          eventEndDate: formatDateForInput(initialData.eventEndDate) || undefined,
          loadOutDate: formatDateForInput(initialData.loadOutDate) || undefined,
          rentalStartDate: formatDateForInput(initialData.rentalStartDate) || undefined,
          rentalEndDate: formatDateForInput(initialData.rentalEndDate) || undefined,
        }
      : {
          projectNumber: "",
          name: "",
          clientId: "",
          status: "ENQUIRY",
          type: "OTHER",
          description: "",
          locationId: "",
          siteContactName: "",
          siteContactPhone: "",
          siteContactEmail: "",
          loadInDate: undefined,
          loadInTime: "",
          eventStartDate: undefined,
          eventStartTime: "",
          eventEndDate: undefined,
          eventEndTime: "",
          loadOutDate: undefined,
          loadOutTime: "",
          rentalStartDate: undefined,
          rentalEndDate: undefined,
          crewNotes: "",
          internalNotes: "",
          clientNotes: "",
          discountPercent: undefined,
          depositPercent: undefined,
          depositPaid: undefined,
          invoicedTotal: undefined,
          tags: [],
        },
  });

  const watchType = form.watch("type");
  const watchStatus = form.watch("status");

  const { data: clientsData } = useQuery({
    queryKey: ["clients", orgId, { pageSize: 200 }],
    queryFn: () => getClients({ pageSize: 200 }),
  });

  const clientOptions = (clientsData?.clients || []).map((c) => ({
    value: c.id,
    label: c.name,
    description: c.contactName || undefined,
  }));

  const { data: locationsData } = useQuery({
    queryKey: ["locations", orgId],
    queryFn: () => getLocations({ pageSize: 100 }),
  });

  const { data: orgTags } = useQuery({
    queryKey: ["org-tags", orgId],
    queryFn: () => getOrgTags(),
  });

  const { data: membersData } = useQuery({
    queryKey: ["org-members", orgId],
    queryFn: () => getOrgMembers({ pageSize: 200 }),
  });

  const memberOptions = (membersData?.members || []).map((m) => ({
    value: m.user.id,
    label: m.user.name || m.user.email,
    description: m.user.name ? m.user.email : undefined,
  }));

  const locationOptions = (locationsData?.locations || []).map((l) => ({
    value: l.id,
    label: l.parent ? `${l.parent.name} → ${l.name}` : l.name,
    description: l.address || undefined,
  }));

  const mutation = useMutation({
    mutationFn: async (data: ProjectFormValues) => {
      const result = isEditing
        ? await updateProject(initialData.id, data)
        : await createProject({ ...data, isTemplate });

      // Sync project managers
      const projectId = result.id;
      const toAdd = selectedManagerIds.filter((id) => !initialManagerIds.includes(id));
      const toRemove = initialManagerIds.filter((id) => !selectedManagerIds.includes(id));
      await Promise.all([
        ...toAdd.map((userId) => addProjectManager(projectId, userId)),
        ...toRemove.map((userId) => removeProjectManager(projectId, userId)),
      ]);

      return result;
    },
    onSuccess: (result) => {
      toast.success(
        isEditing
          ? isTemplate ? "Template updated" : "Project updated"
          : isTemplate ? "Template created" : "Project created"
      );
      router.push(`/projects/${result.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <>
      <form
        onSubmit={form.handleSubmit((d) => mutation.mutate(d))}
      >
        <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
          <div className="space-y-8">
            {/* ─── Project Details ─── */}
            <SectionHeader label="Project Details" />
            <FormSection>
              {!isTemplate && (
                <div className="space-y-2">
                  <Label htmlFor="projectNumber">Project Code</Label>
                  <Input
                    id="projectNumber"
                    {...form.register("projectNumber")}
                    placeholder="e.g. PROJ-2026-0001"
                    className="font-mono"
                  />
                  {form.formState.errors.projectNumber && (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.projectNumber.message}
                    </p>
                  )}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  {...form.register("name")}
                  placeholder="e.g. Summer Festival 2026"
                />
                {form.formState.errors.name && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.name.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Client</Label>
                <Controller
                  control={form.control}
                  name="clientId"
                  render={({ field }) => (
                    <ComboboxPicker
                      value={field.value || ""}
                      onChange={field.onChange}
                      options={clientOptions}
                      placeholder="Select client..."
                      searchPlaceholder="Search clients..."
                      allowClear
                      onCreateNew={() => setQuickCreateClientOpen(true)}
                      createNewLabel="New client"
                      emptyMessage="No clients found."
                    />
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label>Project Manager(s)</Label>
                <ComboboxPicker
                  value=""
                  onChange={(userId) => {
                    if (userId && !selectedManagerIds.includes(userId)) {
                      setSelectedManagerIds((prev) => [...prev, userId]);
                    }
                  }}
                  options={memberOptions.filter((m) => !selectedManagerIds.includes(m.value))}
                  placeholder="Add project manager..."
                  searchPlaceholder="Search members..."
                  emptyMessage="No members found."
                />
                {selectedManagerIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {selectedManagerIds.map((id) => {
                      const member = memberOptions.find((m) => m.value === id);
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 rounded-md bg-bg-muted px-2 py-0.5 text-xs text-fg-2"
                        >
                          {member?.label ?? id}
                          <button
                            type="button"
                            onClick={() => setSelectedManagerIds((prev) => prev.filter((mid) => mid !== id))}
                            className="text-fg-4 hover:text-fg"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Controller
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue>
                          {TYPE_OPTIONS.find((o) => o.value === watchType)?.label ?? "Other"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {TYPE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              {isEditing && (
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Controller
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue>
                            {STATUS_OPTIONS.find((o) => o.value === watchStatus)?.label ?? watchStatus}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              )}
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  {...form.register("description")}
                  placeholder="Brief description of the project"
                  rows={2}
                />
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

            {/* ─── Schedule ─── */}
            <SectionHeader label="Schedule" />
            <FormSection>
              {/* Rental period + billing in a compact layout */}
              <div className="space-y-2">
                <Label htmlFor="rentalStartDate">Rental Start</Label>
                <Input
                  id="rentalStartDate"
                  type="date"
                  {...form.register("rentalStartDate")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rentalEndDate">Rental End</Label>
                <Input
                  id="rentalEndDate"
                  type="date"
                  {...form.register("rentalEndDate")}
                />
              </div>

              {/* Billing time inline with rental dates */}
              <div className="space-y-2">
                <Label htmlFor="billingWeeks">Billing Weeks</Label>
                <Input
                  id="billingWeeks"
                  type="number"
                  min="0"
                  {...form.register("billingWeeks")}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="billingDays">Billing Days</Label>
                  <button
                    type="button"
                    className="text-[11px] text-primary hover:text-primary/80"
                    onClick={() => {
                      const start = form.getValues("rentalStartDate");
                      const end = form.getValues("rentalEndDate");
                      if (!start || !end) {
                        toast.error("Set rental start and end dates first");
                        return;
                      }
                      const startDate = new Date(String(start));
                      const endDate = new Date(String(end));
                      const diffMs = endDate.getTime() - startDate.getTime();
                      if (diffMs <= 0) {
                        toast.error("Rental end must be after rental start");
                        return;
                      }
                      const totalDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                      const weeks = Math.floor(totalDays / 7);
                      const days = totalDays % 7;
                      form.setValue("billingWeeks", weeks);
                      form.setValue("billingDays", days);
                      toast.success(`Set to ${weeks}w ${days}d`);
                    }}
                  >
                    Auto from rental dates
                  </button>
                </div>
                <Input
                  id="billingDays"
                  type="number"
                  min="0"
                  {...form.register("billingDays")}
                  placeholder="0"
                />
              </div>

              {/* Event dates */}
              <div className="space-y-2">
                <Label htmlFor="loadInDate">Load In</Label>
                <div className="flex gap-2">
                  <Input
                    id="loadInDate"
                    type="date"
                    {...form.register("loadInDate")}
                    className="flex-1"
                  />
                  <Input
                    id="loadInTime"
                    type="time"
                    {...form.register("loadInTime")}
                    className="w-28"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="loadOutDate">Load Out</Label>
                <div className="flex gap-2">
                  <Input
                    id="loadOutDate"
                    type="date"
                    {...form.register("loadOutDate")}
                    className="flex-1"
                  />
                  <Input
                    id="loadOutTime"
                    type="time"
                    {...form.register("loadOutTime")}
                    className="w-28"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="eventStartDate">Event Start</Label>
                <div className="flex gap-2">
                  <Input
                    id="eventStartDate"
                    type="date"
                    {...form.register("eventStartDate")}
                    className="flex-1"
                  />
                  <Input
                    id="eventStartTime"
                    type="time"
                    {...form.register("eventStartTime")}
                    className="w-28"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="eventEndDate">Event End</Label>
                <div className="flex gap-2">
                  <Input
                    id="eventEndDate"
                    type="date"
                    {...form.register("eventEndDate")}
                    className="flex-1"
                  />
                  <Input
                    id="eventEndTime"
                    type="time"
                    {...form.register("eventEndTime")}
                    className="w-28"
                  />
                </div>
              </div>
            </FormSection>

            {/* ─── Location & Site Contact ─── */}
            <SectionHeader label="Location & Site Contact" />
            <FormSection>
              <div className="space-y-2 sm:col-span-2">
                <Label>Location</Label>
                <Controller
                  control={form.control}
                  name="locationId"
                  render={({ field }) => (
                    <ComboboxPicker
                      value={field.value || ""}
                      onChange={field.onChange}
                      options={locationOptions}
                      placeholder="Select location..."
                      searchPlaceholder="Search locations..."
                      allowClear
                      onCreateNew={() => setQuickCreateLocationOpen(true)}
                      createNewLabel="New location"
                      emptyMessage="No locations found."
                    />
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="siteContactName">Contact Name</Label>
                <Input
                  id="siteContactName"
                  {...form.register("siteContactName")}
                  placeholder="Contact person on site"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="siteContactPhone">Contact Phone</Label>
                <Input
                  id="siteContactPhone"
                  {...form.register("siteContactPhone")}
                  placeholder="+61 400 000 000"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="siteContactEmail">Contact Email</Label>
                <Input
                  id="siteContactEmail"
                  type="email"
                  {...form.register("siteContactEmail")}
                  placeholder="contact@example.com"
                />
                {form.formState.errors.siteContactEmail && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.siteContactEmail.message}
                  </p>
                )}
              </div>
            </FormSection>

            {/* ─── Financial (edit only) ─── */}
            {isEditing && (
              <>
                <SectionHeader label="Financial" />
                <FormSection>
                  <div className="space-y-2">
                    <Label htmlFor="discountPercent">Discount (%)</Label>
                    <Input
                      id="discountPercent"
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      {...form.register("discountPercent")}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="depositPercent">Deposit (%)</Label>
                    <Input
                      id="depositPercent"
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      {...form.register("depositPercent")}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="depositPaid">Deposit Paid ($)</Label>
                    <Input
                      id="depositPaid"
                      type="number"
                      step="0.01"
                      min="0"
                      {...form.register("depositPaid")}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invoicedTotal">Invoiced Total ($)</Label>
                    <Input
                      id="invoicedTotal"
                      type="number"
                      step="0.01"
                      min="0"
                      {...form.register("invoicedTotal")}
                      placeholder="0.00"
                    />
                  </div>
                </FormSection>
              </>
            )}
          </div>

          <div className="mt-6 flex gap-3 border-t border-border pt-4">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {isEditing ? "Update Project" : "Create Project"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
            >
              Cancel
            </Button>
          </div>
        </div>
      </form>

      <QuickCreateClient
        open={quickCreateClientOpen}
        onOpenChange={setQuickCreateClientOpen}
        onCreated={(id) => {
          form.setValue("clientId", id);
          queryClient.invalidateQueries({
            queryKey: ["clients"],
          });
        }}
      />
      <QuickCreateLocation
        open={quickCreateLocationOpen}
        onOpenChange={setQuickCreateLocationOpen}
        onCreated={(id) => {
          form.setValue("locationId", id);
          queryClient.invalidateQueries({
            queryKey: ["locations"],
          });
        }}
      />
    </>
  );
}
