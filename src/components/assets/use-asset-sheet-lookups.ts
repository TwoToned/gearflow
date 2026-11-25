"use client";

import { useMemo } from "react";

import { useLocations } from "@/hooks/use-locations";
import { useModels } from "@/hooks/use-models";
import { useOrgTags } from "@/hooks/use-org-tags";
import { useSuppliers } from "@/hooks/use-suppliers";
import { useSupplierOrdersBySupplier } from "@/hooks/use-supplier-orders";

/** The reactive pick-lists the asset sheet's pickers read (models of the sheet's kind, locations, suppliers, tags, orders). */
export function useAssetSheetLookups(orgId: string | undefined, kind: "serialized" | "bulk", supplierId?: string) {
  const modelDocs = useModels(orgId);
  const models = useMemo(
    () =>
      [...(modelDocs ?? [])]
        .filter((m) => m.isActive === true && m.assetType === (kind === "bulk" ? "BULK" : "SERIALIZED"))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [modelDocs, kind],
  );

  const locationDocs = useLocations(orgId);
  const locations = useMemo(() => {
    const raw = locationDocs ?? [];
    const nameById = new Map(raw.map((l) => [l.id, l.name]));
    return raw.map((l) => ({ ...l, parent: l.parentId ? { name: nameById.get(l.parentId) ?? "" } : null }));
  }, [locationDocs]);

  const suppliers = (useSuppliers(orgId) ?? []).filter((s) => s.isActive ?? true);
  const orgTags = useOrgTags(orgId);
  const supplierOrders = useSupplierOrdersBySupplier(orgId, supplierId || undefined)?.orders ?? [];
  return { models, locations, suppliers, orgTags, supplierOrders };
}
