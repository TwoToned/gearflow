"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { getLocation } from "@/server/locations";
import { LocationForm } from "@/components/locations/location-form";
import { useActiveOrganization } from "@/lib/auth-client";
import type { LocationFormValues } from "@/lib/validations/asset";

export default function EditLocationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: location, isLoading } = useQuery({
    queryKey: ["location", orgId, id],
    queryFn: () => getLocation(id),
  });

  if (isLoading) return <div className="text-muted-foreground">Loading...</div>;
  if (!location) return <div className="text-muted-foreground">Location not found.</div>;

  const initialData: LocationFormValues & { id: string } = {
    id: location.id,
    name: location.name,
    address: location.address || "",
    latitude: location.latitude ?? null,
    longitude: location.longitude ?? null,
    type: location.type as LocationFormValues["type"],
    isDefault: location.isDefault,
    notes: location.notes || "",
    parentId: location.parentId || null,
    tags: location.tags ?? [],
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="t-title text-fg">Edit Location</h1>
        <p className="text-muted-foreground">{location.name}</p>
      </div>
      <LocationForm initialData={initialData} />
    </div>
  );
}
