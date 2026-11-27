"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarRange, Download, Link2, Siren, User } from "lucide-react";

import type { ListPrimary } from "@/components/ui/list-page-parts";
import { downloadCsv } from "@/lib/download-csv";
import type { ActionItem, ActionMenuSpec } from "@/lib/primitives/types";
import { buildScheduleJobActions } from "@/lib/row-actions/schedule-job";
import type { ScheduleJob } from "@/lib/schedule";
import { confirmSkipReason, moveSkipReason } from "@/lib/schedule-move";
import { useCanDo } from "@/lib/use-permissions";
import { jobHref } from "./schedule-sheets";
import type { ScheduleUrl } from "./use-schedule-url";

const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => toast.success("Link copied"));

/** `Only my jobs` toggles the PM filter to me (the Jobs list's `My jobs` rule). Absent without a session. */
function mineItem(url: ScheduleUrl, userId: string | undefined): ActionItem[] {
  if (!userId) return [];
  const mine = url.filters.pm.length === 1 && url.filters.pm[0] === userId;
  return [{ key: "mine", label: mine ? "Show all jobs" : "Only my jobs", group: "organise", icon: User, onSelect: () => url.setFilter("pm", mine ? [] : [userId]) }];
}

/**
 * The Schedule's menus and primary (§9o.2): the page ⋯ (Only my jobs,
 * Overbookings ›, Crew planner ›, Export this range, Copy link), the job row ⋯
 * and `+ New job`. Each verb is absent, never disabled, when the caller cannot
 * use it (the crew planner needs `crew:read`, the primary `project:create`).
 */
/** What the row ⋯ and the job sheet run for Confirm… and Move dates…: the page's ONE gated write and its ONE dialog. */
export interface ScheduleVerbs {
  confirm: (jobs: ScheduleJob[]) => void | Promise<void>;
  openMove: (jobs: ScheduleJob[]) => void;
}

export function useScheduleActions(url: ScheduleUrl, userId: string | undefined, exportCsv: () => string, verbs: ScheduleVerbs) {
  const router = useRouter();
  const canCrew = useCanDo("crew", "read");
  const canCreate = useCanDo("project", "create");
  const canUpdate = useCanDo("project", "update");

  const pageMenu: ActionMenuSpec = {
    items: [
      ...mineItem(url, userId),
      { key: "overbookings", label: "Overbookings ›", group: "organise", icon: Siren, onSelect: () => router.push("/overbookings") },
      ...(canCrew ? [{ key: "planner", label: "Crew planner ›", group: "organise" as const, icon: CalendarRange, onSelect: () => router.push("/crew/planner") }] : []),
      {
        key: "export",
        label: "Export this range (CSV)",
        group: "reporting",
        icon: Download,
        onSelect: () => downloadCsv(exportCsv(), `schedule-${url.mode}-${url.range.start}.csv`),
      },
      { key: "copy", label: "Copy link", group: "organise", icon: Link2, onSelect: () => copy(window.location.href) },
    ],
  };
  const menuFor = (j: ScheduleJob): ActionMenuSpec =>
    buildScheduleJobActions({
      open: () => router.push(jobHref(j.id)),
      equipment: () => router.push(jobHref(j.id, "equipment")),
      logistics: () => router.push(jobHref(j.id, "logistics")),
      copyLink: () => copy(`${window.location.origin}${jobHref(j.id)}`),
      confirm: canUpdate && confirmSkipReason(j) == null ? () => void verbs.confirm([j]) : undefined,
      moveDates: canUpdate && moveSkipReason(j) == null ? () => verbs.openMove([j]) : undefined,
    });
  const primary: ListPrimary | undefined = canCreate ? { label: "+ New job", onSelect: () => router.push("/projects/new") } : undefined;
  return { pageMenu, menuFor, primary, canCreate, canUpdate };
}
