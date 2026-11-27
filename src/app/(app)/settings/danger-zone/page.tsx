"use client";
// use-client: interactive settings page (confirm dialog, server mutation) (R-8.1.1)

import { useCanDo } from "@/lib/use-permissions";
import { useActiveOrganization } from "@/lib/auth-client";
import { useServerQuery } from "@/hooks/use-server-query";
import { listApiKeys } from "@/server/api-keys";
import { FadeIn } from "@/components/ui/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { KillSwitchCard } from "@/components/settings/api-key-kill-switch";

/**
 * Danger zone (UX Phase 17, D61): the emergency switches, kept apart from the
 * pages people visit every week. Today that is the org-wide API kill switch,
 * which used to sit under API keys. Same server action, same permission
 * (`orgSettings:update`); only where it lives changed.
 */
export default function DangerZoneSettingsPage() {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const canManage = useCanDo("orgSettings", "update");

  const { data, isLoading, refetch } = useServerQuery({
    queryKey: ["api-keys", orgId],
    queryFn: () => listApiKeys(),
    enabled: !!orgId && canManage,
  });

  if (!canManage) {
    return (
      <FadeIn>
        <p className="t-body text-muted">Only people who can change organisation settings can use these switches.</p>
      </FadeIn>
    );
  }

  return (
    <FadeIn>
      {isLoading ? (
        <Skeleton className="h-28 w-full" />
      ) : (
        <KillSwitchCard orgId={orgId} apiKillSwitchAt={data?.apiKillSwitchAt ?? null} onToggled={refetch} />
      )}
    </FadeIn>
  );
}
