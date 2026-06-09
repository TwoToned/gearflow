"use client";

import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { locationSchema, type LocationFormValues } from "@/lib/validations/asset";
import { useActiveOrganization } from "@/lib/auth-client";
import { useOrgCountry } from "@/lib/use-org-country";
import { createLocation, updateLocation } from "@/server/locations";
import { useLocations } from "@/hooks/use-locations";
import { getOrgTags } from "@/server/tags";
import { TagInput } from "@/components/ui/tag-input";
import { AddressInput } from "@/components/ui/address-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { FormSection } from "@/components/layout/page-layouts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface LocationFormProps {
  initialData?: LocationFormValues & { id: string };
}

export function LocationForm({ initialData }: LocationFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEditing = !!initialData?.id;
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const orgCountry = useOrgCountry();

  // Reactive location list from Convex (a sibling created elsewhere appears as a
  // selectable parent instantly). Exclude self — a location can't be its own parent.
  const allLocations = (useLocations(orgId) ?? []).filter(
    (l) => l.id !== initialData?.id
  );

  const { data: orgTags } = useQuery({
    queryKey: ["org-tags", orgId],
    queryFn: () => getOrgTags(),
  });

  const form = useForm<LocationFormValues>({
    resolver: zodResolver(locationSchema),
    defaultValues: initialData || {
      name: "",
      address: "",
      latitude: null,
      longitude: null,
      type: "WAREHOUSE",
      isDefault: false,
      notes: "",
      parentId: null,
    },
  });

  const mutation = useMutation({
    mutationFn: (data: LocationFormValues) =>
      isEditing ? updateLocation(initialData!.id, data) : createLocation(data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      toast.success(isEditing ? "Location updated" : "Location created");
      const id = isEditing ? initialData!.id : (result as { id: string }).id;
      router.push(`/locations/${id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="rounded-lg bg-bg-surface p-5 surface-ring sm:p-6">
      <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))}>
        <FormSection title="Details">
          <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input {...form.register("name")} placeholder="Main Warehouse" />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={form.watch("type")}
                onValueChange={(v) => form.setValue("type", (v ?? "WAREHOUSE") as LocationFormValues["type"])}
              >
                <SelectTrigger>
                  <SelectValue>
                    {{ WAREHOUSE: "Warehouse", VENUE: "Venue", VEHICLE: "Vehicle", OFFSITE: "Offsite" }[form.watch("type") ?? "WAREHOUSE"]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WAREHOUSE">Warehouse</SelectItem>
                  <SelectItem value="VENUE">Venue</SelectItem>
                  <SelectItem value="VEHICLE">Vehicle</SelectItem>
                  <SelectItem value="OFFSITE">Offsite</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Parent Location</Label>
              <Select
                value={form.watch("parentId") || "__none__"}
                onValueChange={(v) => form.setValue("parentId", v === "__none__" ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue>
                    {allLocations.find((l) => l.id === form.watch("parentId"))?.name || "None"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {allLocations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Address</Label>
            <Controller
              name="address"
              control={form.control}
              render={({ field }) => {
                const parentId = form.watch("parentId");
                const parentLoc = parentId ? allLocations.find((l) => l.id === parentId) : null;
                const parentAddress = parentLoc?.address || undefined;
                return (
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
                    placeholder={parentAddress ? `Inherited: ${parentAddress}` : "123 Main St, City"}
                    countryCode={orgCountry}
                  />
                );
              }}
            />
            {form.watch("parentId") && !form.watch("address") && (
              <p className="text-xs text-fg-3">
                Using parent location&apos;s address. Type to set a custom address.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea {...form.register("notes")} rows={3} placeholder="Additional details about this location..." />
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

          <div className="flex items-center gap-2">
            <Checkbox
              checked={form.watch("isDefault")}
              onCheckedChange={(checked) => form.setValue("isDefault", !!checked)}
            />
            <Label className="text-sm">Default location for new assets</Label>
          </div>
          </div>
        </FormSection>

        <div className="mt-6 flex gap-3 border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving..." : isEditing ? "Update Location" : "Create Location"}
          </Button>
        </div>
      </form>
    </div>
  );
}
