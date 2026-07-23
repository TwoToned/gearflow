"use client";

/**
 * Renders operator-defined custom fields as form inputs (Wave 3).
 *
 * Reads the active CustomFieldDefinition list for an entity type and
 * renders one input per definition. The parent owns the values map
 * (`Record<string, string>`) and gets change callbacks — keeps this
 * component form-library-agnostic so it drops into any RHF form.
 *
 * Renders nothing when the org has defined no custom fields, so it's
 * safe to mount unconditionally.
 */

import { useActiveOrganization } from "@/lib/auth-client";
import { useActiveCustomFields } from "@/hooks/use-custom-fields";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { FormSection } from "@/components/layout/page-layouts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Def = any;

interface CustomFieldsInputProps {
  entityType?: "ASSET" | "BULK_ASSET" | "KIT" | "PROJECT";
  /** Current values keyed by fieldKey. */
  values: Record<string, string>;
  /** Called with the full updated map on any field change. */
  onChange: (next: Record<string, string>) => void;
  /** Wrap the fields in a titled FormSection (default true). */
  withSection?: boolean;
}

export function CustomFieldsInput({
  entityType = "ASSET",
  values,
  onChange,
  withSection = true,
}: CustomFieldsInputProps) {
  const { data: activeOrg } = useActiveOrganization();
  const defs = useActiveCustomFields(activeOrg?.id, entityType);

  const list = (defs ?? []) as Def[];
  if (list.length === 0) return null;

  function setValue(key: string, value: string) {
    onChange({ ...values, [key]: value });
  }

  const fields = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {list.map((def) => {
        const id = `cf-${def.id}`;
        const current = values[def.fieldKey] ?? "";
        return (
          <div key={def.id} className="space-y-2">
            <Label htmlFor={id}>
              {def.label}
              {def.required && <span className="ml-0.5 text-destructive">*</span>}
            </Label>

            {def.fieldType === "TEXT" && (
              <Input
                id={id}
                value={current}
                onChange={(e) => setValue(def.fieldKey, e.target.value)}
              />
            )}

            {def.fieldType === "NUMBER" && (
              <Input
                id={id}
                type="number"
                inputMode="decimal"
                value={current}
                onChange={(e) => setValue(def.fieldKey, e.target.value)}
              />
            )}

            {def.fieldType === "DATE" && (
              <Input
                id={id}
                type="date"
                value={current}
                onChange={(e) => setValue(def.fieldKey, e.target.value)}
              />
            )}

            {def.fieldType === "SELECT" && (
              <NativeSelect
                variant="compact"
                id={id}
                value={current}
                onChange={(e) => setValue(def.fieldKey, e.target.value)}
              >
                <option value="">—</option>
                {(def.options as string[]).map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </NativeSelect>
            )}

            {def.fieldType === "BOOLEAN" && (
              <label className="flex h-9 items-center gap-2">
                <Checkbox
                  checked={current === "true"}
                  onCheckedChange={(v) => setValue(def.fieldKey, v === true ? "true" : "false")}
                />
                <span className="text-sm text-fg-3">Yes</span>
              </label>
            )}

            {def.helpText && (
              <p className="text-[11px] text-fg-4">{def.helpText}</p>
            )}
          </div>
        );
      })}
    </div>
  );

  if (!withSection) return fields;
  return <FormSection title="Custom Fields">{fields}</FormSection>;
}
