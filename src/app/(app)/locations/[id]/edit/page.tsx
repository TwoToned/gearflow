"use client";

import { use } from "react";
import Link from "next/link";
import { useLocation } from "@/hooks/use-locations";
import { LocationForm } from "@/components/locations/location-form";
import { RequirePermission } from "@/components/auth/require-permission";
import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/ui/motion";
import { FormSkeleton } from "@/components/ui/skeleton";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import type { LocationFormValues } from "@/lib/validations/asset";

export default function EditLocationPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <RequirePermission resource="location" action="update">
      <EditLocationContent params={params} />
    </RequirePermission>
  );
}

function EditLocationContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  // Reactive location (Convex) — the form only needs location fields.
  // undefined = loading, null = not found.
  const location = useLocation(id);

  if (location === undefined) return <FadeIn><div className="mx-auto max-w-3xl"><FormSkeleton /></div></FadeIn>;
  if (!location) {
    return (
      <div className="mx-auto max-w-3xl rounded-[var(--r-lg)] border border-line border-l-2 border-l-t-out bg-card p-6 text-center">
        <p className="text-ui-text text-ink-2">Location not found.</p>
        <p className="mt-1 text-caption text-muted">It may have been deleted, or you don&apos;t have access to it.</p>
        <Button variant="line" size="sm" className="mt-4" asChild>
          <Link href="/locations">Back to locations</Link>
        </Button>
      </div>
    );
  }

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
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link href="/locations" />}>Locations</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link href={`/locations/${id}`} />}>{location.name}</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Edit</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div>
            <h1 className="t-title text-ink">Edit location</h1>
            <p className="t-body text-muted">{location.name}</p>
          </div>
          <LocationForm initialData={initialData} />
        </div>
    </FadeIn>
  );
}
