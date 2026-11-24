"use client";

import * as React from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useConvex, useConvexAuth } from "convex/react";
import { toast } from "sonner";
import { useServerMutation } from "@/hooks/use-server-mutation";
import { useServerQuery } from "@/hooks/use-server-query";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useCrewRoles } from "@/hooks/use-crew";
import { useProjectServiceWrites } from "@/hooks/use-project-service-writes";
import { useProjectPricingLock } from "@/hooks/use-project-lock";
import { updateServiceCrewStatus } from "@/server/project-services";
import { resolveLockCopy } from "@/lib/lock-copy";
import { resolveRate, calculateEstimatedCost, resolveChargeRate } from "../../../../../convex/lib/crewRate";
import { api } from "../../../../../convex/_generated/api";
import {
  projectServiceSchema,
  type ProjectServiceFormValues,
} from "@/lib/validations/project-service";
import { crewGap, type LogisticsService } from "@/lib/logistics-model";
import { pickConflictBadge, type CrewConflictSummary, type CrewRateTableMember, type ServiceCrewTableRow } from "../../service-dialogs";
import { refreshLogistics } from "../use-logistics-writes";
import { marginOf, serviceFormDefaults } from "./service-form";

type MemberOption = CrewRateTableMember & {
  defaultDayRate: number | null;
  defaultHourlyRate: number | null;
} & CrewConflictSummary;

/** The live assignments as rate-table rows, with the user's unsaved edits laid over them. */
function rowsOf(service: LogisticsService, edits: Record<string, Partial<ServiceCrewTableRow>>): ServiceCrewTableRow[] {
  // EVERY live assignment, whatever its status: the server reconciles `crew` as the desired
  // set, so leaving one out here would delete it on Save.
  return service.crewAssignments
    .map((a) => ({
      crewMemberId: a.crewMember.id,
      rateOverride: a.rateOverride ?? undefined,
      rateType: (a.rateType as ServiceCrewTableRow["rateType"]) ?? "",
      estimatedHours: a.estimatedHours ?? undefined,
      ...edits[a.crewMember.id],
    }));
}

function useCrewMembers(orgId: string | undefined, projectId: string, form: UseFormReturn<ProjectServiceFormValues>, serviceId: string) {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const date = form.watch("date") as unknown as string;
  const endDate = form.watch("endDate") as unknown as string;
  const startMs = date ? new Date(date).getTime() : null;
  const endMs = endDate || date ? new Date(endDate || date).getTime() : null;
  const { data = [] } = useServerQuery({
    queryKey: ["crew-members-for-assignment", orgId, projectId, startMs, endMs, serviceId, isAuthenticated],
    queryFn: () =>
      convex.query(api.crewAssignments.membersForAssignment, {
        projectId,
        orgId: orgId as string,
        rangeStartMs: startMs ?? undefined,
        rangeEndMs: endMs ?? undefined,
        excludeServiceId: serviceId,
      }),
    enabled: !!orgId && isAuthenticated,
  });
  const byId = React.useMemo(() => new Map((data as MemberOption[]).map((m) => [m.id, m])), [data]);
  return { byId, startMs, endMs, hasDates: startMs != null && endMs != null };
}

/** Client-side PREVIEW of the server's crew cost/charge cascades. UX only; the server recomputes (R-9.3). */
function useCrewMath(
  rows: ServiceCrewTableRow[],
  byId: Map<string, MemberOption>,
  role: { defaultRate?: number | null; chargeRate?: number | null; rateType?: string | null } | null,
  range: { startMs: number | null; endMs: number | null },
  chargeOverride: number | undefined,
) {
  const roleRate = role ? { defaultRate: role.defaultRate ?? null, rateType: (role.rateType ?? null) as never } : null;
  function previewCost(row: ServiceCrewTableRow) {
    const m = byId.get(row.crewMemberId);
    const { rate, rateType } = resolveRate(
      row.rateOverride,
      row.rateType || null,
      { defaultDayRate: m?.defaultDayRate ?? null, defaultHourlyRate: m?.defaultHourlyRate ?? null },
      roleRate,
    );
    return { rate, rateType, cost: calculateEstimatedCost(rate, rateType, range.startMs, range.endMs, row.estimatedHours ?? null) };
  }
  const costTotal = rows.reduce((sum, r) => sum + previewCost(r).cost, 0);
  const resolved = resolveChargeRate(chargeOverride, role ? { chargeRate: role.chargeRate ?? null, rateType: (role.rateType ?? null) as never } : null);
  const chargeTotal = resolved
    ? rows.reduce((sum, r) => sum + calculateEstimatedCost(resolved.rate, resolved.rateType, range.startMs, range.endMs, r.estimatedHours ?? null), 0)
    : 0;
  return { previewCost, costTotal, crewChargeTotal: rows.length > 0 ? chargeTotal : 0 };
}

/** The server's own answer for crew pay (`crewRoles.ratesVisible`, the one rule). */
function useRatesVisible(orgId: string | undefined): boolean {
  return useAuthedQuery(api.crewRoles.ratesVisible, orgId ? { orgId } : "skip") === true;
}

/**
 * The crew gap as the form stands (its dates and Needed, the live calls' own
 * days; a newly picked row covers the whole run) — the ONE per-day rule
 * (`crewGap`), never `Needed − rows`.
 */
function formCrewGap(form: UseFormReturn<ProjectServiceFormValues>, rows: ServiceCrewTableRow[], service: LogisticsService) {
  const liveByMember = new Map(service.crewAssignments.map((a) => [a.crewMember.id, a]));
  const date = (form.watch("date") as unknown as string) || null;
  return crewGap({
    date,
    endDate: (form.watch("endDate") as unknown as string) || date,
    crewCountRequired: Number(form.watch("crewCountRequired") || 0),
    crewAssignments: rows.map((r) => liveByMember.get(r.crewMemberId) ?? { status: "PENDING" }),
  });
}

export function useServiceSheet(args: { service: LogisticsService; projectId: string; orgId: string | undefined; onClose: () => void }) {
  const { service, projectId, orgId, onClose } = args;
  const writes = useProjectServiceWrites();
  const form = useForm<ProjectServiceFormValues>({
    resolver: zodResolver(projectServiceSchema),
    // Seeded ONCE: the body is mounted per open and keyed by service id, so a live
    // subscription push can never overwrite what the user is typing.
    defaultValues: React.useMemo(() => serviceFormDefaults(service), []), // eslint-disable-line react-hooks/exhaustive-deps
  });
  const lock = useProjectPricingLock(projectId, orgId);
  const [edits, setEdits] = React.useState<Record<string, Partial<ServiceCrewTableRow>>>({});
  const rows = rowsOf(service, edits);
  const members = useCrewMembers(orgId, projectId, form, service.id);
  const roleDocs = useCrewRoles(orgId);
  const roleId = form.watch("crewRoleId") as string;
  const role = (roleDocs ?? []).find((r) => r.id === roleId) ?? null;
  const rawOverride = form.watch("chargeRateOverride");
  const override = rawOverride != null && (rawOverride as unknown) !== "" ? Number(rawOverride) : undefined;
  const math = useCrewMath(rows, members.byId, role, members, override);
  const crewGapNow = formCrewGap(form, rows, service);
  const payVisible = useRatesVisible(orgId);

  const save = useServerMutation({
    // Crew is whatever is live NOW (Pick crew writes immediately), plus the rate edits made here.
    mutationFn: (data: ProjectServiceFormValues) => writes.update(service.id, { ...data, crew: rows }),
    onSuccess: () => { toast.success("Service updated"); refreshLogistics(projectId); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  const crewStatus = useServerMutation({
    mutationFn: ({ status }: { status: "OFFERED" | "CONFIRMED" }) => updateServiceCrewStatus(service.id, status),
    onSuccess: (r, { status }) => {
      toast.success(`${status === "OFFERED" ? "Offers sent" : "Crew confirmed"} (${(r as { updated: number }).updated} updated)`);
      refreshLogistics(projectId);
    },
    onError: (e) => toast.error(e.message),
  });

  const unitPrice = Number(form.watch("unitPrice")) || 0;
  const discount = Number(form.watch("discount")) || 0;
  const charge = Math.max(0, (unitPrice > 0 ? unitPrice : math.crewChargeTotal) - discount);
  const cost = rows.length > 0 ? math.costTotal : Number(form.watch("costTotal")) || 0;
  const clashes = rows.filter((r) => {
    const b = pickConflictBadge(members.byId.get(r.crewMemberId));
    return b != null && b.severity !== "preferred";
  }).length;

  return {
    form, rows, role, roleDocs, members, math, save, crewStatus, clashes, crewGap: crewGapNow, payVisible,
    charge, cost, margin: marginOf(charge, cost),
    locked: lock.pricingLocked, lockReason: resolveLockCopy(lock).oneLiner,
    editRow: (id: string, patch: Partial<ServiceCrewTableRow>) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } })),
  };
}

export type ServiceSheetState = ReturnType<typeof useServiceSheet>;
