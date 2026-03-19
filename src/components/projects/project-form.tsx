"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  projectSchema,
  type ProjectFormValues,
} from "@/lib/validations/project";
import { createProject, updateProject } from "@/server/projects";
import { getClients } from "@/server/clients";
import { getLocations } from "@/server/locations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormSection } from "@/components/layout/page-layouts";
import { ComboboxPicker } from "@/components/ui/combobox-picker";
import { QuickCreateClient } from "@/components/clients/quick-create-client";
import { QuickCreateLocation } from "@/components/assets/quick-create-location";
import { useActiveOrganization } from "@/lib/auth-client";
import { getOrgTags } from "@/server/tags";
import { TagInput } from "@/components/ui/tag-input";

interface ProjectFormProps {
  initialData?: ProjectFormValues & { id: string; isTemplate?: boolean };
  isTemplate?: boolean;
}

function formatDateForInput(date: unknown): string {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(String(date));
  if (isNaN(d.getTime())) return "";
  return d.toISOString().split("T")[0];
}

export function ProjectForm({ initialData, isTemplate: isTemplateProp }: ProjectFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const isEditing = !!initialData;
  const isTemplate = isTemplateProp ?? initialData?.isTemplate ?? false;
  const [quickCreateClientOpen, setQuickCreateClientOpen] = useState(false);
  const [quickCreateLocationOpen, setQuickCreateLocationOpen] = useState(false);

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

  const locationOptions = (locationsData?.locations || []).map((l) => ({
    value: l.id,
    label: l.parent ? `${l.parent.name} → ${l.name}` : l.name,
    description: l.address || undefined,
  }));

  const mutation = useMutation({
    mutationFn: (data: ProjectFormValues) =>
      isEditing
        ? updateProject(initialData.id, data)
        : createProject({ ...data, isTemplate }),
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
          <div className="space-y-6">
            {/* Project Details */}
            <FormSection title="Project Details">
              {!isTemplate && (
                <div className="space-y-2">
                  <Label htmlFor="projectNumber">Project Code *</Label>
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
                <Label htmlFor="type">Type</Label>
                <select
                  id="type"
                  {...form.register("type")}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="DRY_HIRE">Dry Hire</option>
                  <option value="WET_HIRE">Wet Hire</option>
                  <option value="INSTALLATION">Installation</option>
                  <option value="TOUR">Tour</option>
                  <option value="CORPORATE">Corporate</option>
                  <option value="THEATRE">Theatre</option>
                  <option value="FESTIVAL">Festival</option>
                  <option value="CONFERENCE">Conference</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  {...form.register("description")}
                  placeholder="Brief description of the project"
                  rows={3}
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

            {/* Rental Period */}
            <FormSection title="Rental Period">
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
            </FormSection>

            {/* Dates & Times */}
            <FormSection title="Dates &amp; Times">
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
                    className="w-32"
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
                    className="w-32"
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
                    className="w-32"
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
                    className="w-32"
                  />
                </div>
              </div>
            </FormSection>

            {/* Location & Site Contact */}
            <FormSection title="Location &amp; Site Contact">
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
                <Label htmlFor="siteContactName">Site Contact Name</Label>
                <Input
                  id="siteContactName"
                  {...form.register("siteContactName")}
                  placeholder="Contact person on site"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="siteContactPhone">Site Contact Phone</Label>
                <Input
                  id="siteContactPhone"
                  {...form.register("siteContactPhone")}
                  placeholder="+61 400 000 000"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="siteContactEmail">Site Contact Email</Label>
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

            {/* Notes */}
            <FormSection title="Notes">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="crewNotes">Crew Notes</Label>
                <Textarea
                  id="crewNotes"
                  {...form.register("crewNotes")}
                  placeholder="Notes visible to crew members"
                  rows={3}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="internalNotes">Internal Notes</Label>
                <Textarea
                  id="internalNotes"
                  {...form.register("internalNotes")}
                  placeholder="Internal notes (not visible to client)"
                  rows={3}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="clientNotes">Client Notes</Label>
                <Textarea
                  id="clientNotes"
                  {...form.register("clientNotes")}
                  placeholder="Notes visible on client-facing documents"
                  rows={3}
                />
              </div>
            </FormSection>

            {/* Financial */}
            <FormSection title="Financial" className="[&>div:last-child]:lg:grid-cols-4">
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
