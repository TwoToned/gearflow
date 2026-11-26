"use client";
// use-client: reads the viewer's permissions (R-8.1.1)

import { useCanDo, useCurrentRole } from "@/lib/use-permissions";
import { useServerQuery } from "@/hooks/use-server-query";
import { isXeroConfigured } from "@/server/xero";
import type { SettingsCaps, SettingsCapsLoad } from "@/lib/settings-registry";

/**
 * The viewer's settings capabilities, in the shape `settingsGateOpen` reads.
 * Xero is gated twice: `invoice:xero_manage` plus the deployment having a
 * Xero developer app at all. It defaults to closed while that loads, so the
 * index never flashes a row that is about to disappear.
 */
export function useSettingsCaps(): SettingsCaps & SettingsCapsLoad {
  const { isLoading: rolesLoading } = useCurrentRole();
  const orgSettingsRead = useCanDo("orgSettings", "read");
  const orgMembersRead = useCanDo("orgMembers", "read");
  const checkItemRead = useCanDo("checkItem", "read");
  const projectManageLineItems = useCanDo("project", "manage_line_items");
  const canManageXero = useCanDo("invoice", "xero_manage");
  const { data: xeroConfig, isLoading: xeroLoading } = useServerQuery({
    queryKey: ["xero-configured"],
    queryFn: () => isXeroConfigured(),
  });
  return {
    orgSettingsRead,
    orgMembersRead,
    checkItemRead,
    projectManageLineItems,
    xeroManage: canManageXero && xeroConfig?.configured === true,
    rolesLoaded: !rolesLoading,
    xeroLoaded: !xeroLoading,
  };
}
