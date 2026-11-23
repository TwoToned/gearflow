"use client";

import * as React from "react";

import { api } from "../../../../../convex/_generated/api";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useCrewRolesForSettings, useCrewSkills, type CrewRoleDoc } from "@/hooks/use-crew";
import { weekRange, type OpenCall, type PlannerMember } from "@/lib/crew-planner";

/**
 * Everything the planner reads for one week, as live subscriptions (a call
 * offered, accepted or confirmed in another tab shows here at once):
 * - `crewAvailability.plannerData` — the roster with each person's calls and
 *   availability blocks (pay redacted below manager, server-side);
 * - `crewPlanner.openCalls` — the Needs crew list (services short of people);
 * - `crewTimeEntries.approvedHoursByMember` — the Hours column's logged half;
 * - the roles (`listForSettings`, rates stripped below the pay line) and skills.
 * The week's range is derived from the URL week, so the query args are stable.
 */
export interface PlannerData {
  members: PlannerMember[] | undefined;
  open: OpenCall[];
  openTruncated: boolean;
  logged: Record<string, number>;
  roles: CrewRoleDoc[];
  skillName: (id: string) => string;
  skills: { id: string; name: string }[];
}

export function usePlannerData(orgId: string | undefined, week: string): PlannerData {
  const range = React.useMemo(() => weekRange(week), [week]);
  const members = useAuthedQuery(api.crewAvailability.plannerData, orgId ? { orgId, ...range } : "skip") as PlannerMember[] | undefined;
  const openRes = useAuthedQuery(api.crewPlanner.openCalls, orgId ? { orgId, ...range } : "skip") as { calls: OpenCall[]; truncated: boolean } | undefined;
  const ids = React.useMemo(() => (members ?? []).map((m) => m.id), [members]);
  const logged = useAuthedQuery(api.crewTimeEntries.approvedHoursByMember, orgId && ids.length ? { orgId, crewMemberIds: ids, ...range } : "skip");
  const roles = useCrewRolesForSettings(orgId);
  const skills = useCrewSkills(orgId);
  return React.useMemo(() => {
    const skillList = (skills ?? []).map((s) => ({ id: s.id, name: s.name }));
    const byId = new Map(skillList.map((s) => [s.id, s.name]));
    return {
      members,
      open: openRes?.calls ?? [],
      openTruncated: openRes?.truncated ?? false,
      logged: (logged as Record<string, number> | undefined) ?? {},
      roles: roles ?? [],
      skills: skillList,
      skillName: (id: string) => byId.get(id) ?? "",
    };
  }, [members, openRes, logged, roles, skills]);
}
