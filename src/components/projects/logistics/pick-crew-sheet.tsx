"use client";

/**
 * Pick crew (spec 8): members sorted preferred, available, pencilled, booked,
 * each with how free they are on the service's days and their rate, the
 * service's role filter ON by default, and `Request availability instead` for
 * first-come-first-filled. Advisory only: nothing blocks a double-booking, it
 * is named on the row (FEATUREDOCS/31). Picking creates PENDING assignments
 * through the same `createNative` the crew side uses; offers go out separately.
 */
import * as React from "react";
import { toast } from "sonner";

import { PersonAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { useCrewAssignmentWrites } from "@/hooks/use-crew-assignment-writes";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { crewPickRank, dayKeyOf, dayLabel, filledOf, type LogisticsService } from "@/lib/logistics-model";
import { serviceTypeToPhase } from "../../../../convex/lib/serviceSchedule";
import { api } from "../../../../convex/_generated/api";
import { pickConflictBadge, type CrewConflictSummary } from "../service-dialogs";
import { refreshLogistics } from "./use-logistics-writes";

type Member = {
  id: string;
  firstName: string;
  lastName: string;
  image: string | null;
  defaultDayRate: number | null;
  defaultHourlyRate: number | null;
  crewRole: { id: string; name: string } | null;
} & CrewConflictSummary;

const nameOf = (m: Member) => m.firstName + " " + m.lastName;

function rateOf(m: Member): string {
  if (m.defaultDayRate != null) return "$" + m.defaultDayRate + "/day";
  if (m.defaultHourlyRate != null) return "$" + m.defaultHourlyRate + "/hr";
  return "";
}

/** Members not already on the service, role-filtered when asked, best pick first. */
export function rankMembers(all: Member[], taken: Set<string>, roleId: string | null): Member[] {
  const rank = (m: Member) => crewPickRank(pickConflictBadge(m)?.severity ?? null);
  return all
    .filter((m) => !taken.has(m.id) && (!roleId || m.crewRole?.id === roleId))
    .sort((a, b) => rank(a) - rank(b) || nameOf(a).localeCompare(nameOf(b)));
}

function MemberRow({ m, checked, onToggle }: { m: Member; checked: boolean; onToggle: () => void }) {
  const badge = pickConflictBadge(m);
  return (
    <li className="flex min-h-14 items-center gap-3 border-t border-line px-1">
      <Checkbox aria-label={"Pick " + nameOf(m)} checked={checked} onCheckedChange={onToggle} />
      <PersonAvatar name={nameOf(m)} src={m.image ?? undefined} className="size-8" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-ui-text font-medium text-ink">{nameOf(m)}</div>
        <div className="truncate text-caption text-muted">{[m.crewRole?.name, rateOf(m)].filter(Boolean).join(" · ")}</div>
      </div>
      {badge ? (
        <StatusIndicator category="conflictSeverity" value={badge.severity} label={badge.label} variant="pill" />
      ) : (
        <span className="text-caption text-muted">Available</span>
      )}
    </li>
  );
}

/** Creates the picked members as PENDING assignments on the service; offers go out separately. */
function useAssignCrew(projectId: string, service: LogisticsService, done: () => void) {
  const asg = useCrewAssignmentWrites();
  const [saving, setSaving] = React.useState(false);

  async function assign(ids: string[]) {
    setSaving(true);
    try {
      for (const id of ids) {
        await asg.create(projectId, {
          crewMemberId: id,
          crewRoleId: service.crewRole?.id ?? "",
          serviceId: service.id,
          status: "PENDING",
          phase: serviceTypeToPhase(service.type) as "EVENT",
          isProjectManager: false,
          generateShifts: false,
          startDate: dayKeyOf(service.date),
          endDate: dayKeyOf(service.endDate) || dayKeyOf(service.date),
          startTime: service.startTime ?? "",
          endTime: service.endTime ?? "",
        });
      }
      refreshLogistics(projectId);
      toast.success("Added " + ids.length + " crew to " + service.title);
      done();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return { assign, saving };
}

function useMembers(orgId: string | undefined, projectId: string, service: LogisticsService) {
  const start = service.date ? new Date(service.date).getTime() : undefined;
  const end = service.endDate ? new Date(service.endDate).getTime() : start;
  return useAuthedQuery(
    api.crewAssignments.membersForAssignment,
    orgId ? { projectId, orgId, rangeStartMs: start, rangeEndMs: end, excludeServiceId: service.id } : "skip",
  ) as Member[] | undefined;
}

function RoleFilter({
  service, roleOnly, onToggle, onRequestAvailability,
}: { service: LogisticsService; roleOnly: boolean; onToggle: () => void; onRequestAvailability: () => void }) {
  return (
    <div className="flex items-center gap-3 text-ui-text">
      {service.crewRole && (
        <button
          type="button"
          aria-pressed={roleOnly}
          onClick={onToggle}
          className={roleOnly ? "font-medium text-ink underline decoration-red decoration-2 underline-offset-4" : "text-muted"}
        >
          {"Role: " + service.crewRole.name}
        </button>
      )}
      <button type="button" onClick={onRequestAvailability} className="ml-auto text-link hover:underline">
        Request availability instead
      </button>
    </div>
  );
}

function MemberList({
  loading, list, picked, onToggle,
}: { loading: boolean; list: Member[]; picked: Set<string>; onToggle: (id: string) => void }) {
  return (
    <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto">
      {loading && <li className="p-3 text-muted">Loading crew...</li>}
      {!loading && list.length === 0 && <li className="p-3 text-muted">No crew to add. Try all roles.</li>}
      {list.map((m) => (
        <MemberRow key={m.id} m={m} checked={picked.has(m.id)} onToggle={() => onToggle(m.id)} />
      ))}
    </ul>
  );
}

function PickBody({
  orgId, projectId, service, onDone, onRequestAvailability,
}: {
  orgId: string | undefined;
  projectId: string;
  service: LogisticsService;
  onDone: () => void;
  onRequestAvailability: () => void;
}) {
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [roleOnly, setRoleOnly] = React.useState(true);
  const members = useMembers(orgId, projectId, service);
  const { assign, saving } = useAssignCrew(projectId, service, onDone);

  const taken = new Set(filledOf(service).map((a) => a.crewMember.id));
  const list = rankMembers(members ?? [], taken, roleOnly ? service.crewRole?.id ?? null : null);
  const needed = Math.max((service.crewCountRequired ?? 0) - taken.size, 0);
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  return (
    <>
      <SheetHeader>
        <SheetTitle>Pick crew</SheetTitle>
        <SheetDescription>
          {service.title + " · " + dayLabel(dayKeyOf(service.date)) + (needed > 0 ? " · " + needed + " needed" : "")}
        </SheetDescription>
      </SheetHeader>
      <RoleFilter service={service} roleOnly={roleOnly} onToggle={() => setRoleOnly((v) => !v)} onRequestAvailability={onRequestAvailability} />
      <MemberList loading={members === undefined} list={list} picked={picked} onToggle={toggle} />
      <SheetFooter>
        <Button variant="line" onClick={onDone}>Cancel</Button>
        <Button onClick={() => void assign([...picked])} disabled={picked.size === 0 || saving}>
          {picked.size ? "Add " + picked.size : "Add"}
        </Button>
      </SheetFooter>
    </>
  );
}

export function PickCrewSheet({
  open, onOpenChange, orgId, projectId, service, onRequestAvailability,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | undefined;
  projectId: string;
  service: LogisticsService | null;
  onRequestAvailability: () => void;
}) {
  const isMobile = useIsMobile();
  return (
    <Sheet open={open && !!service} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? "bottom" : "right"} className="flex flex-col overflow-hidden sm:max-w-md">
        {service && (
          <PickBody
            key={service.id}
            orgId={orgId}
            projectId={projectId}
            service={service}
            onDone={() => onOpenChange(false)}
            onRequestAvailability={onRequestAvailability}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
