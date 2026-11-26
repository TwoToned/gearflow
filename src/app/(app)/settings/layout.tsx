"use client";
// use-client: reads the pathname and the viewer's permissions (R-8.1.1)

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { PageMeta } from "@/components/layout/page-meta";
import { useSettingsCaps } from "@/hooks/use-settings-caps";
import { useActiveOrganization } from "@/lib/auth-client";
import { settingsEntryForPath, settingsGateOpen } from "@/lib/settings-registry";
import { cn, focusRing } from "@/lib/utils";

function AccessDenied({ what }: { what: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <h2 className="t-title text-ink">Access denied</h2>
      <p className="mt-2 t-body text-muted">You don&apos;t have permission to {what}.</p>
    </div>
  );
}

/**
 * Settings shell (UX Phase 17, D57). The index at `/settings` is the only
 * navigation: the second rail and the phone jump-select are gone. A section is
 * a record page without tabs: back link, title, a muted identity line. The
 * per-route gate is the registry's own `settingsGateOpen`, so a deep link to a
 * page the role can't open reads the same as the index hiding it.
 */
function SectionHeader({ entry, orgName }: { entry: ReturnType<typeof settingsEntryForPath>; orgName: string }) {
  return (
    <div className="min-w-0">
      <Link
        href="/settings"
        className={cn("-ml-1 mb-2 inline-flex min-h-11 items-center gap-1 rounded-[var(--r)] px-1 t-small text-muted hover:text-ink md:min-h-0", focusRing)}
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        Settings
      </Link>
      {entry ? <PageMeta title={entry.title} /> : null}
      <h1 className="t-page-title text-ink truncate">{entry?.title ?? "Settings"}</h1>
      <p className="t-small text-muted truncate">
        {orgName}
        {entry ? ` · ${entry.description}` : ""}
      </p>
    </div>
  );
}

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const caps = useSettingsCaps();
  const { data: activeOrg } = useActiveOrganization();
  const orgName = activeOrg?.name ?? "Organisation";

  if (!caps.orgSettingsRead && !caps.orgMembersRead) {
    return <AccessDenied what="access settings" />;
  }

  const entry = settingsEntryForPath(pathname);
  if (entry && !settingsGateOpen(entry.gate, caps)) {
    return <AccessDenied what={`open ${entry.title.toLowerCase()} settings`} />;
  }

  return (
    <div className="space-y-6">
      {pathname === "/settings" ? (
        <div className="min-w-0 md:max-w-3xl">
          <h1 className="t-page-title text-ink">Settings</h1>
          <p className="t-small text-muted truncate">{orgName}</p>
        </div>
      ) : (
        <SectionHeader entry={entry} orgName={orgName} />
      )}
      <div className="min-w-0 md:max-w-3xl">{children}</div>
    </div>
  );
}
