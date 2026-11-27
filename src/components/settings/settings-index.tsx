"use client";
// use-client: search box + live status words (R-8.1.1)

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { SearchInput } from "@/components/ui/input";
import { StatusWord } from "@/components/ui/status-word";
import { useSettingsCaps } from "@/hooks/use-settings-caps";
import { useServerQuery } from "@/hooks/use-server-query";
import { useOrgMembers } from "@/hooks/use-org-members";
import { usePendingInvitations } from "@/hooks/use-pending-invitations";
import { useXeroIntegration } from "@/hooks/use-xero-linked";
import { useActiveOrganization } from "@/lib/auth-client";
import { getMiraSettings } from "@/server/mira-settings";
import {
  SETTINGS_GROUPS,
  hiddenSettings,
  searchSettings,
  visibleSettings,
  type SettingsCaps,
  type SettingsEntry,
} from "@/lib/settings-registry";
import { settingsStatus, type SettingsStatusInputs } from "@/lib/settings-status";
import { cn, focusRing } from "@/lib/utils";

function useTeamFact(caps: SettingsCaps, orgId: string | undefined): SettingsStatusInputs["team"] {
  const { data: members } = useOrgMembers(caps.orgMembersRead ? orgId : undefined);
  const { data: invitations } = usePendingInvitations(caps.orgMembersRead ? orgId : undefined);
  return members ? { members: members.length, invitations: invitations?.length ?? 0 } : null;
}

function useMiraFact(caps: SettingsCaps, orgId: string | undefined): SettingsStatusInputs["mira"] {
  const { data: mira } = useServerQuery({
    queryKey: ["settings-index-mira", orgId],
    queryFn: () => getMiraSettings(),
    enabled: !!orgId && caps.orgSettingsRead,
  });
  return mira ? { hasApiKey: mira.hasApiKey, writeAccessEnabled: mira.writeAccessEnabled } : null;
}

function useXeroFact(caps: SettingsCaps): SettingsStatusInputs["xero"] {
  const integration = useXeroIntegration();
  if (!caps.xeroManage || integration === undefined) return null;
  return { connected: integration?.isConnected === true };
}

/** The status facts, each read only when its row is openable by this viewer. */
function useStatusInputs(caps: SettingsCaps): SettingsStatusInputs {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  return { team: useTeamFact(caps, orgId), xero: useXeroFact(caps), mira: useMiraFact(caps, orgId) };
}

function IndexRow({ entry, status }: { entry: SettingsEntry; status: ReturnType<typeof settingsStatus> }) {
  return (
    <li className="border-t border-line first:border-t-0">
      <Link
        href={entry.href}
        className={cn("flex min-h-16 items-center gap-4 px-1 py-3 hover:bg-elev md:min-h-14", focusRing)}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-ui-text font-medium text-ink">{entry.title}</p>
          <p className="truncate t-micro text-muted">{entry.description}</p>
        </div>
        {status ? <StatusWord status={status} className="shrink-0" /> : null}
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted" />
      </Link>
    </li>
  );
}

export function SettingsIndex() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const caps = useSettingsCaps();
  const statuses = useStatusInputs(caps);

  const setQuery = (next: string) => {
    const sp = new URLSearchParams(params.toString());
    if (next) sp.set("q", next);
    else sp.delete("q");
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const visible = visibleSettings(caps);
  const hidden = hiddenSettings(caps);
  const matches = searchSettings(visible, q);

  return (
    <div className="space-y-8">
      <SearchInput
        aria-label="Search settings"
        placeholder="Search settings"
        value={q}
        onChange={(e) => setQuery(e.target.value)}
        className="text-base md:text-ui-text"
      />

      {matches.length === 0 ? (
        <p className="t-body text-muted">Nothing in settings matches &ldquo;{q}&rdquo;.</p>
      ) : (
        SETTINGS_GROUPS.map((group) => {
          const rows = matches.filter((e) => e.group === group.key);
          if (rows.length === 0) return null;
          return (
            <section key={group.key} aria-labelledby={`settings-group-${group.key}`}>
              <h2 id={`settings-group-${group.key}`} className="mb-1 t-overline text-muted">
                {group.label}
              </h2>
              <ul className="border-b border-t border-line">
                {rows.map((entry) => (
                  <IndexRow
                    key={entry.key}
                    entry={entry}
                    status={entry.statusKey ? settingsStatus(entry.statusKey, statuses) : null}
                  />
                ))}
              </ul>
            </section>
          );
        })
      )}

      {hidden.length > 0 && !q ? (
        <p className="t-micro text-muted">
          Not shown for your role: {hidden.map((e) => e.title).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}
