"use client";

/**
 * AddBar's Enter: create the service now with smart defaults. A template result
 * applies the template's own defaults on top. The toast offers Undo, which is
 * genuinely reversible here (a brand-new service has no crew or invoice to
 * lose), and remembers the new id so a second Enter can open it in the editor.
 */
import * as React from "react";
import { toast } from "sonner";

import type { AddBarResult } from "@/components/ui/add-bar";
import { useProjectServiceWrites } from "@/hooks/use-project-service-writes";
import { dayLabel, defaultServiceDay, TYPE_WORDS, type ServiceType } from "@/lib/logistics-model";
import type { ProjectServiceFormValues } from "@/lib/validations/project-service";
import { isClientServiceType } from "../../../../convex/lib/serviceTypes";
import { parseResultId, type ServiceTemplateLite } from "./add-service-bar";
import { refreshLogistics } from "./use-logistics-writes";

export interface QuickAddContext {
  projectId: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  /** Effective job window as `yyyy-MM-dd`. */
  window: { start: string; end: string };
  templates: (ServiceTemplateLite & Record<string, unknown>)[];
  /** The warehouse counter (default location) and Warehouse role, for client pick up / drop off. */
  counter?: { address: string; latitude: number | null; longitude: number | null } | null;
  warehouseRoleId?: string | null;
}

/** What a template contributes on top of the type's defaults (nothing without one). */
function templateDefaults(tpl?: Record<string, unknown>): Partial<ProjectServiceFormValues> {
  if (!tpl) return {};
  return {
    title: tpl.title as string,
    description: (tpl.description as string) ?? "",
    showOnDocuments: (tpl.showOnDocuments as boolean) ?? false,
    unitPrice: (tpl.defaultUnitPrice as number) || undefined,
    vehicleDescription: (tpl.defaultVehicle as string) ?? "",
    crewCountRequired: (tpl.defaultCrewCount as number) || undefined,
  };
}

/** Client pick up / drop off: at OUR counter, one Warehouse person, no charge, no truck. */
function clientValues(
  type: ServiceType,
  day: string,
  ctx: Pick<QuickAddContext, "counter" | "warehouseRoleId">,
  tpl?: Record<string, unknown>,
): ProjectServiceFormValues {
  return {
    type,
    title: TYPE_WORDS[type],
    date: day,
    endDate: day,
    address: ctx.counter?.address ?? "",
    latitude: ctx.counter?.latitude ?? null,
    longitude: ctx.counter?.longitude ?? null,
    showOnDocuments: false,
    quantity: 1,
    taxable: true,
    crewCountRequired: 1,
    crewRoleId: ctx.warehouseRoleId ?? "",
    ...templateDefaults(tpl),
  };
}

/** The create payload for a type (and optionally the template it came from). */
export function quickAddValues(
  type: ServiceType,
  ctx: Pick<QuickAddContext, "address" | "latitude" | "longitude" | "window" | "counter" | "warehouseRoleId">,
  tpl?: Record<string, unknown>,
): ProjectServiceFormValues {
  const day = defaultServiceDay(type, ctx.window);
  if (isClientServiceType(type)) return clientValues(type, day, ctx, tpl);
  return {
    type,
    title: TYPE_WORDS[type],
    date: day,
    endDate: day,
    address: ctx.address,
    latitude: ctx.latitude,
    longitude: ctx.longitude,
    showOnDocuments: false,
    quantity: 1,
    taxable: true,
    ...templateDefaults(tpl),
  };
}

export function useQuickAdd(ctx: QuickAddContext, onOpenEditor: (serviceId: string) => void) {
  const svc = useProjectServiceWrites();
  const created = React.useRef(new Map<string, string>());

  async function add(r: AddBarResult): Promise<void> {
    const parsed = parseResultId(r.id);
    const tpl = "templateId" in parsed ? ctx.templates.find((t) => t.id === parsed.templateId) : undefined;
    const type = "type" in parsed ? parsed.type : tpl?.type;
    if (!type) return;
    try {
      const values = quickAddValues(type, ctx, tpl);
      const { id } = await svc.create(ctx.projectId, values);
      created.current.set(r.id, id);
      refreshLogistics(ctx.projectId);
      toast.success("Added " + values.title + " · " + dayLabel(String(values.date)), {
        action: {
          label: "Undo",
          onClick: () => {
            svc.remove(id).then(
              () => { refreshLogistics(ctx.projectId); toast.success("Undone"); },
              (e: Error) => toast.error(e.message),
            );
          },
        },
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function openEditor(r: AddBarResult): void {
    const id = created.current.get(r.id);
    if (id) onOpenEditor(id);
  }

  return { add, openEditor };
}
