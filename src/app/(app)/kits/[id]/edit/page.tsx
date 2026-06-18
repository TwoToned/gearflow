"use client";

import { use } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { KitForm } from "@/components/kits/kit-form";
import { useKit } from "@/hooks/use-kits";
import { RequirePermission } from "@/components/auth/require-permission";
import { FadeIn } from "@/components/ui/motion";
import { FormSkeleton } from "@/components/ui/skeleton";
import { cn, focusRing } from "@/lib/utils";

export default function EditKitPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <RequirePermission resource="kit" action="update">
      <EditKitContent params={params} />
    </RequirePermission>
  );
}

function EditKitContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  // Reactive kit straight from Convex — the edit form only needs kit scalar
  // fields (no cross-domain composition), so a pure useQuery subscription suffices.
  const kit = useKit(id);

  if (kit === undefined) return <FadeIn><div className="mx-auto max-w-3xl"><FormSkeleton /></div></FadeIn>;
  if (!kit) return <div className="t-body text-muted">Kit not found.</div>;

  return (
    <FadeIn>
      <div className="mx-auto max-w-3xl space-y-4">
        <nav className="mb-4 flex items-center gap-1 text-caption text-muted">
          <Link href="/kits" className={cn("hover:text-ink transition-colors rounded-sm", focusRing)}>Kits</Link>
          <ChevronRight className="h-3 w-3" />
          <Link href={`/kits/${id}`} className={cn("hover:text-ink transition-colors rounded-sm", focusRing)}>{kit.name}</Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-ink-2">Edit</span>
        </nav>
        <div>
          <h1 className="t-title text-ink">Edit kit</h1>
          <p className="t-body text-muted">
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
            checkMode: (kit.checkMode as "KIT_LEVEL" | "PER_ITEM") || "KIT_LEVEL",
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
