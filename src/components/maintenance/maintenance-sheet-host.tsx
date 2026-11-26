"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { MaintenanceSheet } from "@/components/maintenance/maintenance-sheet";
import type { MaintenanceSheetInitial } from "@/lib/maintenance-sheet";
import { useCurrentRole } from "@/lib/use-permissions";

interface Props {
  /** `new` opens log-a-job on `?new=1` (the list); `edit` opens on `?edit=1` for `record` (the job's page). */
  mode: "new" | "edit";
  /** Required for `edit`; the sheet does not open until it has arrived. */
  record?: MaintenanceSheetInitial | null;
}

const NEEDS: Record<Props["mode"], { action: "create" | "update"; message: string }> = {
  new: { action: "create", message: "You don't have permission to log maintenance." },
  edit: { action: "update", message: "You don't have permission to edit maintenance." },
};

/**
 * Opens the Maintenance sheet from the URL so the old `/maintenance/new` and `/maintenance/[id]/edit` links, the `N`
 * shortcut and the menus all land in ONE place. Closing removes the param (replace, so Back does not reopen it). A caller
 * without the permission the sheet needs never sees it open: the param is dropped with a toast once their permissions have
 * ARRIVED (an unloaded permission set is "not known yet", never "no").
 */
export function MaintenanceSheetHost({ mode, record }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { permissions } = useCurrentRole();
  const wanted = params.get(mode) === "1";
  const need = NEEDS[mode];
  const allowed = permissions ? (permissions.maintenance?.includes(need.action) ?? false) : null;
  const open = wanted && allowed === true && (mode === "new" || !!record);

  const dropParam = React.useCallback(() => {
    const q = new URLSearchParams(params.toString());
    q.delete(mode);
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [params, mode, router, pathname]);

  React.useEffect(() => {
    if (!wanted || allowed !== false) return;
    toast.error(need.message);
    dropParam();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per arrival of the unwanted param
  }, [wanted, allowed]);

  return <MaintenanceSheet open={open} onOpenChange={(next) => !next && dropParam()} record={mode === "edit" ? (record ?? undefined) : undefined} />;
}
