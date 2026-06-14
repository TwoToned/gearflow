"use client";

/**
 * Read-only display of custom field values on an entity detail page (Wave 3).
 *
 * Renders nothing when the org has no active definitions or the entity has
 * no values — safe to mount unconditionally. Definition order is honoured;
 * orphaned value keys (definition deleted) are not shown.
 */

import { useActiveOrganization } from "@/lib/auth-client";
import { useActiveCustomFields } from "@/hooks/use-custom-fields";
import { SectionHeader } from "@/components/layout/page-layouts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Def = any;

interface CustomFieldsDisplayProps {
  entityType?: "ASSET" | "BULK_ASSET" | "KIT" | "PROJECT";
  values: Record<string, string> | null | undefined;
}

function formatValue(def: Def, raw: string): string {
  if (def.fieldType === "BOOLEAN") return raw === "true" ? "Yes" : "No";
  if (def.fieldType === "DATE") {
    const d = new Date(raw);
    return Number.isNaN(d.getTime())
      ? raw
      : d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  }
  return raw;
}

export function CustomFieldsDisplay({
  entityType = "ASSET",
  values,
}: CustomFieldsDisplayProps) {
  const { data: activeOrg } = useActiveOrganization();
  const defs = useActiveCustomFields(activeOrg?.id, entityType);

  const list = (defs ?? []) as Def[];
  const vals = values ?? {};

  // Only render definitions that have a non-empty value on this entity.
  const populated = list.filter((d) => {
    const v = vals[d.fieldKey];
    return v != null && v !== "";
  });
  if (populated.length === 0) return null;

  return (
    <div className="border-b border-border pb-4 space-y-2">
      <SectionHeader label="Custom Fields" />
      <div className="space-y-1 text-sm">
        {populated.map((def) => (
          <div key={def.id} className="flex justify-between gap-2">
            <span className="text-fg-3">{def.label}</span>
            <span className="font-medium t-data text-right">
              {formatValue(def, vals[def.fieldKey])}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
