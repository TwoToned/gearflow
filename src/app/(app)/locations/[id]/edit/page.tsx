"use client";

import { use } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useLocation } from "@/hooks/use-locations";
import { LocationForm } from "@/components/locations/location-form";
import { FadeIn } from "@/components/ui/motion";
import { FormSkeleton } from "@/components/ui/skeleton";
import type { LocationFormValues } from "@/lib/validations/asset";

export default function EditLocationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  // Reactive location (Convex) — the form only needs location fields.
  // undefined = loading, null = not found.
  const location = useLocation(id);

  if (location === undefined) return <FadeIn><div className="mx-auto max-w-3xl"><FormSkeleton /></div></FadeIn>;
  if (!location) return <div className="text-fg-3">Location not found.</div>;

  const initialData: LocationFormValues & { id: string } = {
    id: location.id,
    name: location.name,
    address: location.address || "",
    latitude: location.latitude ?? null,
    longitude: location.longitude ?? null,
    type: (location.type ?? "WAREHOUSE") as LocationFormValues["type"],
    isDefault: location.isDefault ?? false,
    notes: location.notes || "",
    parentId: location.parentId || null,
    tags: location.tags ?? [],
  };

  return (
    <FadeIn>
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center gap-2 text-sm text-fg-3 mb-4">
          <Link href="/locations" className="hover:text-fg transition-colors">Locations</Link>
          <ChevronRight className="h-3 w-3" />
          <Link href={`/locations/${id}`} className="hover:text-fg transition-colors">{location.name}</Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-fg">Edit</span>
        </div>
        <div>
          <h1 className="t-title text-fg">Edit Location</h1>
          <p className="t-body text-fg-3">{location.name}</p>
        </div>
        <LocationForm initialData={initialData} />
      </div>
    </FadeIn>
  );
}
