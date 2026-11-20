"use client";

import { useMemo } from "react";
import { useOrgMembers } from "@/hooks/use-org-members";

interface RosterMember {
  userId: string;
  user?: { name?: string | null } | null;
}

/**
 * The org roster as names by user id plus picker options — the ONE derivation
 * the jobs list (project managers) and the floor (packers) both read, from the
 * roster the members page already loads (no new query).
 */
export function useMemberRoster(orgId: string | undefined) {
  const { data } = useOrgMembers(orgId) as { data: RosterMember[] | undefined };
  return useMemo(() => {
    const nameOf = new Map<string, string>();
    for (const m of data ?? []) if (m.user?.name) nameOf.set(m.userId, m.user.name);
    const options = [...nameOf].map(([id, name]) => ({ id, name }));
    return { nameOf, options };
  }, [data]);
}
