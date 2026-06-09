"use client";

import { use } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { KitForm } from "@/components/kits/kit-form";
import { useKit } from "@/hooks/use-kits";
import { FadeIn } from "@/components/ui/motion";

export default function EditKitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  // Reactive kit straight from Convex — the edit form only needs kit scalar
  // fields (no cross-domain composition), so a pure useQuery subscription suffices.
  const kit = useKit(id);

  if (kit === undefined) return <div className="t-body text-fg-3">Loading...</div>;
  if (!kit) return <div className="t-body text-fg-3">Kit not found.</div>;

  return (
    <FadeIn>
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center gap-2 text-sm text-fg-3 mb-4">
          <Link href="/kits" className="hover:text-fg transition-colors">Kits</Link>
          <ChevronRight className="h-3 w-3" />
          <Link href={`/kits/${id}`} className="hover:text-fg transition-colors">{kit.name}</Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-fg">Edit</span>
        </div>
        <div>
          <h1 className="t-title text-fg">Edit Kit</h1>
          <p className="t-body text-fg-3">
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
    </FadeIn>
  );
}
