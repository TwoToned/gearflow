"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { KitSheet } from "@/components/kits/kit-sheet";
import type { KitSheetInitial } from "@/lib/kit-sheet-initial";
import { useCurrentRole } from "@/lib/use-permissions";

interface Props {
  /** `new` opens create on `?new=1` (the list); `edit` and `copy` open on `?edit=1` / `?copy=1` for `kit` (the record). */
  mode: "new" | "edit" | "copy";
  /** Required for `edit` and `copy`; the sheet does not open until it has arrived. */
  kit?: KitSheetInitial | null;
}

/** What the sheet needs: Edit is a kit update; New and Duplicate both create a kit. */
const NEEDS: Record<Props["mode"], { action: "create" | "update"; message: string }> = {
  new: { action: "create", message: "You don't have permission to create kits." },
  copy: { action: "create", message: "You don't have permission to create kits." },
  edit: { action: "update", message: "You don't have permission to edit kits." },
};

/**
 * Opens the Kit sheet from the URL so the old `/kits/new` and `/kits/[id]/edit` links, the `N` shortcut and the
 * menus all land in ONE place. Closing removes the param (replace, so Back does not reopen it). A caller without the
 * permission the sheet needs never sees it open: the param is dropped with a toast once their permissions have
 * ARRIVED (an unloaded permission set is "not known yet", never "no").
 */
export function KitSheetHost({ mode, kit }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { permissions } = useCurrentRole();
  const wanted = params.get(mode) === "1";
  const need = NEEDS[mode];
  const allowed = permissions ? (permissions.kit?.includes(need.action) ?? false) : null;
  const open = wanted && allowed === true && (mode === "new" || !!kit);

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

  const onOpenChange = (next: boolean) => {
    if (!next) dropParam();
  };

  return <KitSheet open={open} onOpenChange={onOpenChange} kit={mode === "edit" ? (kit ?? undefined) : undefined} copyOf={mode === "copy" ? (kit ?? undefined) : undefined} />;
}
