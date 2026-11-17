"use client";

/**
 * Logistics' `AddBar` (spec 5.5, 8): chips Delivery - Pickup - Call - Labour -
 * Misc; typing narrows them and searches the org's service templates. Enter
 * adds with smart defaults (the type's day from the job window, the venue,
 * a template's own defaults); a second Enter opens today's service dialog.
 * `Call` is a one-level choice (Bump in, Bump out), never a silent default.
 * It replaces `Add service` as the entry point; it owns no data.
 */
import { AddBar, type AddBarResult } from "@/components/ui/add-bar";
import type { ServiceType } from "@/lib/logistics-model";
import { TYPE_WORDS } from "@/lib/logistics-model";

export interface ServiceTemplateLite {
  id: string;
  type: ServiceType;
  title: string;
  isActive?: boolean;
}

const KINDS = [
  { key: "delivery", label: "Delivery" },
  { key: "pickup", label: "Pickup" },
  { key: "call", label: "Call" },
  { key: "labour", label: "Labour" },
  { key: "misc", label: "Misc" },
];

const KIND_TYPES: Record<string, ServiceType[]> = {
  delivery: ["DELIVERY"],
  pickup: ["PICKUP"],
  call: ["BUMP_IN", "BUMP_OUT"],
  labour: ["LABOUR"],
  misc: ["MISC"],
};

const kindOf = (t: ServiceType): string => Object.keys(KIND_TYPES).find((k) => KIND_TYPES[k].includes(t)) ?? "misc";

/** The result id encodes what to create: `type:BUMP_IN` or `tpl:<templateId>`. */
export function parseResultId(id: string): { type: ServiceType } | { templateId: string } {
  return id.startsWith("tpl:") ? { templateId: id.slice(4) } : { type: id.slice(5) as ServiceType };
}

export function serviceResults(
  query: string,
  kind: string | null,
  templates: ServiceTemplateLite[],
): AddBarResult[] {
  const q = query.trim().toLowerCase();
  const types = kind ? KIND_TYPES[kind] ?? [] : Object.values(KIND_TYPES).flat();
  const fixed = types.map((t) => ({ id: "type:" + t, kind: kindOf(t), title: TYPE_WORDS[t], subtitle: "New service" }));
  const tpl = templates
    .filter((t) => t.isActive !== false && (!kind || kindOf(t.type) === kind))
    .map((t) => ({ id: "tpl:" + t.id, kind: kindOf(t.type), title: t.title, subtitle: "Template · " + TYPE_WORDS[t.type] }));
  return [...fixed, ...tpl].filter((r) => !q || r.title.toLowerCase().includes(q));
}

export function AddServiceBar({
  templates, onAdd, onOpenEditor, className, disabled,
}: {
  templates: ServiceTemplateLite[];
  onAdd: (r: AddBarResult) => void | Promise<void>;
  onOpenEditor: (r: AddBarResult) => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <AddBar
      className={className}
      kinds={KINDS}
      disabled={disabled}
      phoneLabel="Add service"
      placeholder="Add a delivery, call, labour or template..."
      search={async (q, kind) => serviceResults(q, kind, templates)}
      onAdd={onAdd}
      onOpenEditor={onOpenEditor}
    />
  );
}
