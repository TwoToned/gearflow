"use client";

/**
 * Every write the Logistics tab makes, in one place: each toasts, and each
 * genuinely reversible one hands its toast an Undo backed by ONE closure (a
 * second surface that wants the same undo reuses that closure, never a second
 * implementation — playbook §3.4). Deletes and sent offers are not reversible,
 * so they confirm first and toast without Undo.
 */
import { toast } from "sonner";

import { useCrewAssignmentWrites } from "@/hooks/use-crew-assignment-writes";
import { refreshProjectCrew } from "@/hooks/use-project-crew";
import { refreshProjectDetail } from "@/hooks/use-project-detail";
import { refreshProjectServices, refreshProjectServicesSummary } from "@/hooks/use-project-services";
import { useProjectServiceWrites } from "@/hooks/use-project-service-writes";
import { daysBetween, dayKeyOf, reverseMoves, type LogisticsService, type ServiceStatus, type ShiftMove } from "@/lib/logistics-model";
import { sendCrewOffers } from "@/server/crew-communication";

type Undo = () => Promise<void>;

export function refreshLogistics(projectId: string): void {
  refreshProjectServices(projectId);
  refreshProjectServicesSummary(projectId);
  refreshProjectDetail(projectId);
  refreshProjectCrew(projectId);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Group ids by their previous value so one bulk call per distinct previous status restores them. */
function groupByPrevious(ids: string[], prev: Map<string, string>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const p = prev.get(id);
    if (p) groups.set(p, [...(groups.get(p) ?? []), id]);
  }
  return groups;
}

export function useLogisticsWrites(projectId: string) {
  const svc = useProjectServiceWrites();
  const asg = useCrewAssignmentWrites();

  /** Runs `fn`, refreshes, toasts; `undo` (when given) becomes the toast's Undo and refreshes too. */
  async function run<T>(fn: () => Promise<T>, message: (r: T) => string, undo?: Undo): Promise<T | undefined> {
    try {
      const r = await fn();
      refreshLogistics(projectId);
      const text = message(r);
      if (!undo) toast.success(text);
      else
        toast.success(text, {
          action: {
            label: "Undo",
            onClick: () => {
              undo().then(
                () => { refreshLogistics(projectId); toast.success("Undone"); },
                (e: Error) => toast.error(e.message),
              );
            },
          },
        });
      return r;
    } catch (e) {
      toast.error((e as Error).message);
      return undefined;
    }
  }

  const setServiceStatus = (rows: LogisticsService[], status: ServiceStatus) => {
    const prev = new Map(rows.map((s) => [s.id, s.status as string]));
    const ids = rows.map((s) => s.id);
    return run(
      () => svc.bulkSetStatus(ids, status),
      () => (ids.length === 1 ? "Status updated" : `Updated ${plural(ids.length, "service")}`),
      async () => {
        for (const [p, group] of groupByPrevious(ids, prev)) await svc.bulkSetStatus(group, p as ServiceStatus);
      },
    );
  };

  const setCrewStatus = (rows: { id: string; status: string }[], status: string) => {
    const prev = new Map(rows.map((r) => [r.id, r.status]));
    const ids = rows.map((r) => r.id);
    return run(
      () => asg.bulkStatus(ids, status),
      () => (ids.length === 1 ? "Status updated" : `Updated ${plural(ids.length, "assignment")}`),
      async () => {
        for (const [p, group] of groupByPrevious(ids, prev)) await asg.bulkStatus(group, p);
      },
    );
  };

  /** Atomic shift of services + their crew calls; Undo is the same call, negative offsets. */
  const shiftServices = (moves: ShiftMove[], message: (r: { services: number; crewCalls: number }) => string) =>
    run(() => svc.shiftSchedule(projectId, { moves }), message, async () => {
      await svc.shiftSchedule(projectId, { moves: reverseMoves(moves) });
    });

  const moveServiceToDay = (s: LogisticsService, targetDay: string) => {
    const offsetDays = daysBetween(dayKeyOf(s.date), targetDay);
    if (offsetDays === 0) return Promise.resolve(undefined);
    return shiftServices(
      [{ offsetDays, serviceIds: [s.id] }],
      (r) => `${s.title} moved${r.crewCalls ? ` with ${plural(r.crewCalls, "crew call")}` : ""}`,
    );
  };

  const deleteServices = (ids: string[]) =>
    run(() => svc.bulkDelete(ids), (r) => `Deleted ${plural(r.deleted, "service")}`);

  const removeCrew = (ids: string[]) =>
    run(() => asg.bulkDelete(ids), (r) => `Removed ${plural(r.deleted, "assignment")}`);

  const sendOffers = (assignmentIds: string[]) =>
    run(
      () => sendCrewOffers({ assignmentIds }),
      (r) =>
        r.errors.length
          ? `Sent ${r.sent} of ${r.total} offers. ${r.errors[0]}`
          : `${plural(r.sent, "offer")} sent`,
    );

  return {
    svc, asg, run,
    setServiceStatus, setCrewStatus, shiftServices, moveServiceToDay,
    deleteServices, removeCrew, sendOffers,
  };
}
