"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSession, useActiveOrganization, organization } from "@/lib/auth-client";
import { useServerQuery } from "@/hooks/use-server-query";
import { getMyOrganizations } from "@/server/public-org";
import { showError } from "@/lib/show-error";

const UNDO_MS = 8000;

export interface OrgSwitch {
  orgs: { id: string; name: string; slug: string; role: string }[];
  activeOrgId: string | undefined;
  activeOrgName: string | undefined;
  switchingId: string | null;
  /** Switches the active org, lands on Home and toasts with Undo (the same closure). */
  switchTo: (targetOrgId: string) => Promise<void>;
}

/** Two-letter initials for the rail's org tile. */
export function orgInitials(name: string | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "·";
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
  return letters.toUpperCase();
}

/** One-shot Undo action for the switch toast: it re-runs `apply` with the previous org. */
function undoAction(previous: string | undefined, apply: (id: string) => Promise<void>) {
  if (!previous) return undefined;
  let undone = false;
  return {
    label: "Undo",
    onClick: async () => {
      if (undone) return;
      undone = true;
      try {
        await apply(previous);
      } catch (e) {
        showError(e);
      }
    },
  };
}

/**
 * The ONE org-switch closure (sidebar head + phone More sheet, D69). Membership-
 * derived (never a client-filtered list of all orgs, §4.3.1). `organization.setActive`
 * is also the re-authentication trigger (convex-provider reacts to the orgId change),
 * so the Undo toast calls the very same `apply` rather than a second code path.
 */
export function useOrgSwitch(): OrgSwitch {
  const router = useRouter();
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const { data: myOrgs } = useServerQuery({
    queryKey: ["my-organizations", session?.user?.id],
    queryFn: () => getMyOrganizations(),
    enabled: !!session?.user?.id,
  });
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const activeId = activeOrg?.id;

  const apply = useCallback(
    async (id: string) => {
      await organization.setActive({ organizationId: id });
      // Always land on a tenant-neutral root: never carry an id belonging to the
      // previous org into the new one (design doc §4.3.1).
      router.push("/dashboard");
    },
    [router],
  );

  const switchTo = useCallback(
    async (targetOrgId: string) => {
      if (targetOrgId === activeId || switchingId) return;
      setSwitchingId(targetOrgId);
      try {
        await apply(targetOrgId);
        const name = myOrgs?.find((o) => o.id === targetOrgId)?.name ?? "organisation";
        toast(`Switched to ${name}`, { duration: UNDO_MS, action: undoAction(activeId, apply) });
      } catch (e) {
        showError(e);
      } finally {
        setSwitchingId(null);
      }
    },
    [apply, activeId, myOrgs, switchingId],
  );

  return { orgs: myOrgs ?? [], activeOrgId: activeId, activeOrgName: activeOrg?.name, switchingId, switchTo };
}
