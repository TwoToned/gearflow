"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";

import { getKit } from "@/server/kits";
import { KitForm } from "@/components/kits/kit-form";
import { useActiveOrganization } from "@/lib/auth-client";

export default function EditKitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;

  const { data: kit, isLoading } = useQuery({
    queryKey: ["kit", orgId, id],
    queryFn: () => getKit(id),
  });

  if (isLoading) return <div className="text-muted-foreground">Loading...</div>;
  if (!kit) return <div className="text-muted-foreground">Kit not found.</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="t-title text-fg">Edit Kit</h1>
        <p className="text-muted-foreground">
          Update details for {kit.assetTag} &mdash; {kit.name}.
        </p>
      </div>
      <KitForm
        initialData={{
          id: kit.id,
          name: kit.name,
          assetTag: kit.assetTag,
          description: kit.description || undefined,
          categoryId: kit.categoryId || undefined,
          status: kit.status as "AVAILABLE" | "CHECKED_OUT" | "IN_MAINTENANCE" | "RETIRED" | "INCOMPLETE",
          condition: kit.condition as "NEW" | "GOOD" | "FAIR" | "POOR" | "DAMAGED",
          locationId: kit.locationId || undefined,
          weight: kit.weight ? Number(kit.weight) : undefined,
          caseType: kit.caseType || undefined,
          caseDimensions: kit.caseDimensions || undefined,
          notes: kit.notes || undefined,
          purchaseDate: kit.purchaseDate ? new Date(kit.purchaseDate) : undefined,
          purchasePrice: kit.purchasePrice ? Number(kit.purchasePrice) : undefined,
          image: kit.image || undefined,
          images: kit.images || [],
          isActive: kit.isActive,
          tags: kit.tags ?? [],
        }}
      />
    </div>
  );
}
